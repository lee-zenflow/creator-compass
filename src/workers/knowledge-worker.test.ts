import { describe, expect, test, vi } from "vitest";

import type { PrivateStorage, PrivateUpload } from "@/server/storage/storage";
import type { KnowledgeChunk } from "@/server/knowledge/chunk-text";

import {
  handleKnowledgeJob,
  processKnowledgeIngestion,
  startKnowledgeWorker,
  type KnowledgeIngestionWorkerRepository,
  type WorkerKnowledgeJob,
} from "./knowledge-worker";

const jobId = "60000000-0000-4000-8000-000000000001";
const sourceId = "70000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

class MemoryRepository implements KnowledgeIngestionWorkerRepository {
  record: WorkerKnowledgeJob | null = {
    id: jobId,
    sourceId,
    submittedByUserId: userId,
    inputKind: "file",
    status: "queued",
    sourceName: "定位资料",
    publicUrl: null,
    objectKey: `private/user/${userId}/knowledge.txt`,
    originalMime: "text/plain",
    contentHash: "original-hash",
    defaultPlatform: "xiaohongshu",
    defaultContentType: "note",
    defaultTags: ["定位"],
  };
  readonly statuses: string[] = [];
  readonly failures: Array<{ failureCode: string; safeFailureDetail: string }> = [];
  persisted: Parameters<KnowledgeIngestionWorkerRepository["persistPendingChunks"]>[1] | null = null;
  gets = 0;
  async getById(id: string) { this.gets += 1; return id === jobId ? this.record : null; }
  async markStatus(_jobId: string, status: "fetching" | "parsing" | "tagging") {
    this.statuses.push(status);
  }
  async persistPendingChunks(_jobId: string, input: Parameters<KnowledgeIngestionWorkerRepository["persistPendingChunks"]>[1]) {
    this.persisted = input;
    this.statuses.push("pending_review");
  }
  async markFailed(_jobId: string, failure: { failureCode: string; safeFailureDetail: string }) {
    this.failures.push(failure);
    this.statuses.push("failed");
  }
}

class MemoryStorage implements PrivateStorage {
  readonly puts: PrivateUpload[] = [];
  readonly objects = new Map<string, Uint8Array>();
  readonly deletes: string[] = [];
  async check() {}
  async put(actor: Parameters<PrivateStorage["put"]>[0], input: PrivateUpload) {
    this.puts.push(input);
    const objectKey = `private/user/${actor.kind === "user" ? actor.userId : "guest"}/archive.txt`;
    this.objects.set(objectKey, input.body);
    return { objectKey };
  }
  async get(_actor: Parameters<PrivateStorage["get"]>[0], objectKey: string) {
    const bytes = this.objects.get(objectKey);
    if (!bytes) throw new Error("private storage secret detail");
    return bytes;
  }
  async delete(_actor: Parameters<PrivateStorage["delete"]>[0], objectKey: string) {
    this.deletes.push(objectKey);
    this.objects.delete(objectKey);
  }
}

const tags = {
  summary: "个人IP定位方法",
  normalizedKeywords: ["个人IP定位"],
  tags: ["定位"],
  platform: "xiaohongshu",
  contentType: "note",
};

describe("knowledge ingestion worker", () => {
  test("advances file ingestion through parsing and tagging but persists only pending review chunks", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    storage.objects.set(repository.record!.objectKey!, new TextEncoder().encode("个人IP定位".repeat(80)));

    const embedding = Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0);
    await processKnowledgeIngestion(jobId, {
      repository,
      storage,
      safeFetch: vi.fn(),
      tagChunks: vi.fn(async (chunks) => chunks.map((chunk: KnowledgeChunk) => ({ chunk, tags }))),
      embedChunks: vi.fn(async (texts) => ({
        model: "BAAI/bge-small-zh-v1.5",
        version: "1",
        dimensions: 512 as const,
        vectors: texts.map(() => embedding),
      })),
    });

    expect(repository.statuses).toEqual(["fetching", "parsing", "tagging", "pending_review"]);
    expect(repository.persisted?.chunks.length).toBeGreaterThan(0);
    expect(repository.persisted?.chunks[0]).toMatchObject({
      tags,
      reviewStatus: "pending",
      retrievalScope: "development_only",
      enabled: true,
      isDemo: false,
      embedding,
      embeddingStatus: "ready",
      embeddingModel: "BAAI/bge-small-zh-v1.5",
    });
    expect(repository.persisted?.chunks[0]).not.toHaveProperty("approved");
  });

  test("keeps ingestion usable with an explicit failed embedding status when the local model is offline", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    storage.objects.set(repository.record!.objectKey!, new TextEncoder().encode("个人IP定位".repeat(80)));

    await processKnowledgeIngestion(jobId, {
      repository,
      storage,
      safeFetch: vi.fn(),
      tagChunks: vi.fn(async (chunks) => chunks.map((chunk: KnowledgeChunk) => ({ chunk, tags }))),
      embedChunks: vi.fn(async () => { throw new Error("EMBEDDING_UNAVAILABLE"); }),
    });

    expect(repository.persisted?.chunks[0]).toMatchObject({
      embedding: null,
      embeddingStatus: "failed",
      embeddingModel: null,
    });
    expect(repository.statuses.at(-1)).toBe("pending_review");
  });

  test("extracts URL HTML before archiving normalized plain text", async () => {
    const repository = new MemoryRepository();
    repository.record = {
      ...repository.record!,
      inputKind: "url",
      publicUrl: "https://example.com/article",
      objectKey: null,
      originalMime: null,
    };
    const storage = new MemoryStorage();

    await processKnowledgeIngestion(jobId, {
      repository,
      storage,
      safeFetch: vi.fn(async () => ({
        url: new URL("https://example.com/article"),
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        bytes: new TextEncoder().encode("<script>alert(1)</script><p>安全正文</p>"),
      })),
      tagChunks: vi.fn(async (chunks) => chunks.map((chunk: KnowledgeChunk) => ({ chunk, tags }))),
    });

    expect(storage.puts[0]).toMatchObject({ mime: "text/plain", name: expect.stringMatching(/\.txt$/) });
    expect(new TextDecoder().decode(storage.puts[0]!.body)).toBe("安全正文");
    expect(repository.persisted).toMatchObject({
      archivedObjectKey: expect.stringContaining("archive.txt"),
      originalMime: "text/html",
    });
  });

  test("stores only a safe failure code and never the private thrown detail", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(processKnowledgeIngestion(jobId, {
      repository,
      storage,
      safeFetch: vi.fn(),
      tagChunks: vi.fn(),
    })).rejects.toThrow("STORAGE_READ_FAILED");

    expect(repository.failures).toEqual([{
      failureCode: "STORAGE_READ_FAILED",
      safeFailureDetail: "Knowledge source could not be read from private storage.",
    }]);
    expect(JSON.stringify(repository.failures)).not.toContain("secret detail");
    expect(JSON.stringify([...consoleError.mock.calls, ...consoleLog.mock.calls]))
      .not.toMatch(/secret detail|private\/user|objectKey/);
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  test("removes a newly archived private object when URL ingestion fails later", async () => {
    const repository = new MemoryRepository();
    repository.record = {
      ...repository.record!, inputKind: "url", publicUrl: "https://example.com/private",
      objectKey: null, originalMime: null,
    };
    const storage = new MemoryStorage();
    await expect(processKnowledgeIngestion(jobId, {
      repository,
      storage,
      safeFetch: vi.fn(async () => ({
        url: new URL("https://example.com/private"), status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        bytes: new TextEncoder().encode("私密输入".repeat(80)),
      })),
      tagChunks: vi.fn(async () => { throw new Error("tagging failed with secret objectKey"); }),
    })).rejects.toThrow("AI_UPSTREAM_ERROR");

    expect(storage.deletes).toEqual([expect.stringContaining("archive.txt")]);
    expect(storage.objects.size).toBe(0);
    expect(JSON.stringify(repository.failures)).not.toMatch(/私密输入|objectKey/);
  });

  test("retries a transient private-storage failure while attempts remain", async () => {
    const result = await handleKnowledgeJob(
      { id: "queue-job", data: { ingestionJobId: jobId }, retryCount: 0, retryLimit: 1 },
      {
        repository: new MemoryRepository(),
        storage: new MemoryStorage(),
        safeFetch: vi.fn(),
        tagChunks: vi.fn(),
      },
    );

    expect(result.status).toBe("failed");
  });

  test("keeps the original retry decision when recording the safe failure also fails", async () => {
    class FailingFailureRepository extends MemoryRepository {
      override async markFailed() {
        throw new Error("database unavailable");
      }
    }
    const result = await handleKnowledgeJob(
      { id: "queue-job", data: { ingestionJobId: jobId }, retryCount: 0, retryLimit: 1 },
      {
        repository: new FailingFailureRepository(),
        storage: new MemoryStorage(),
        safeFetch: vi.fn(),
        tagChunks: vi.fn(),
      },
    );

    expect(result.status).toBe("failed");
  });

  test("dead-letters a non-retryable parse failure even when attempts remain", async () => {
    const repository = new MemoryRepository();
    const storage = new MemoryStorage();
    storage.objects.set(repository.record!.objectKey!, new Uint8Array([0xff]));
    const result = await handleKnowledgeJob(
      { id: "queue-job", data: { ingestionJobId: jobId }, retryCount: 0, retryLimit: 3 },
      { repository, storage, safeFetch: vi.fn(), tagChunks: vi.fn() },
    );
    expect(result.status).toBe("deadletter");
    expect(repository.failures).toEqual([expect.objectContaining({ failureCode: "INVALID_TEXT_ENCODING" })]);
  });

  test("dead-letters an invalid queue payload before database access", async () => {
    const repository = new MemoryRepository();
    const result = await handleKnowledgeJob(
      { id: "bad-job", data: { ingestionJobId: "not-a-uuid" }, retryCount: 0, retryLimit: 1 },
      { repository } as never,
    );
    expect(result.status).toBe("deadletter");
    expect(repository.gets).toBe(0);
  });

  test("dead-letters a valid payload whose ingestion record no longer exists", async () => {
    const repository = new MemoryRepository();
    repository.record = null;

    const result = await handleKnowledgeJob(
      { id: "missing-job", data: { ingestionJobId: jobId }, retryCount: 0, retryLimit: 1 },
      {
        repository,
        storage: new MemoryStorage(),
        safeFetch: vi.fn(),
        tagChunks: vi.fn(),
      },
    );

    expect(result.status).toBe("deadletter");
  });

  test("registers on the shared boss and stopping the consumer does not stop that boss", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const offWork = vi.fn().mockResolvedValue(undefined);
    const boss = {
      start: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      work,
      offWork,
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const worker = await startKnowledgeWorker(boss as never, new MemoryRepository(), {
      storage: new MemoryStorage(),
      safeFetch: vi.fn(),
      tagChunks: vi.fn(),
    });
    expect(work).toHaveBeenCalledWith(
      "knowledge-ingest",
      expect.objectContaining({ includeMetadata: true, perJobResults: true }),
      expect.any(Function),
    );
    await worker.stop();
    expect(offWork).toHaveBeenCalledWith("knowledge-ingest");
    expect(boss.stop).not.toHaveBeenCalled();
  });
});
