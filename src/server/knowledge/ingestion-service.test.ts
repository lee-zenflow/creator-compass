import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import type { PrivateStorage, PrivateUpload } from "@/server/storage/storage";

import {
  createKnowledgeIngestionService,
  type KnowledgeIngestionRepository,
  type KnowledgeSourceRecord,
} from "./ingestion-service";

const admin: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "admin",
};
const user: CurrentActor = {
  kind: "user",
  userId: "20000000-0000-4000-8000-000000000002",
  role: "user",
};
const textInput = {
  kind: "text" as const,
  name: "定位方法",
  text: "个人IP定位要从目标用户、差异化价值和内容支柱开始。",
  licenseNote: "内部授权资料",
};

class MemoryStorage implements PrivateStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: PrivateUpload[] = [];
  readonly deletes: string[] = [];
  async check() {}
  async put(actor: CurrentActor, upload: PrivateUpload) {
    this.puts.push(upload);
    const owner = actor.kind === "user" ? actor.userId : actor.guestSessionId;
    const objectKey = `private/${actor.kind}/${owner}/object-${this.puts.length}.txt`;
    this.objects.set(objectKey, upload.body);
    return { objectKey };
  }
  async get(actor: CurrentActor, objectKey: string) {
    const owner = actor.kind === "user" ? actor.userId : actor.guestSessionId;
    if (!objectKey.startsWith(`private/${actor.kind}/${owner}/`)) throw new Error("FORBIDDEN");
    const value = this.objects.get(objectKey);
    if (!value) throw new Error("PRIVATE_OBJECT_NOT_FOUND");
    return value;
  }
  async delete(_actor: CurrentActor, objectKey: string) {
    this.deletes.push(objectKey);
    this.objects.delete(objectKey);
  }
}

class MemoryRepository implements KnowledgeIngestionRepository {
  readonly transactionToken = { name: "same-transaction" };
  readonly sources: KnowledgeSourceRecord[] = [];
  readonly jobs: Array<{ id: string; sourceId: string; submittedByUserId: string; inputKind: "url" | "file" | "text" }> = [];
  readonly items = new Map<string, { id: string; sourceId: string; reviewStatus: "pending" | "approved" | "rejected"; retrievalScope: "production" | "development_only"; enabled: boolean }>();
  readonly sourceReviewEvents: Array<{
    sourceId: string;
    reviewerUserId: string;
    previousReviewStatus: "pending" | "approved" | "rejected";
    newReviewStatus: "approved" | "rejected";
    reason: string | null;
  }> = [];
  readonly itemReviewEvents: Array<{
    itemId: string;
    sourceId: string;
    reviewerUserId: string;
    previousReviewStatus: "pending" | "approved" | "rejected";
    newReviewStatus: "approved" | "rejected";
    reason: string | null;
  }> = [];
  transactionFailure: Error | null = null;
  async transaction<T>(work: (transaction: unknown) => Promise<T>) {
    if (this.transactionFailure) throw this.transactionFailure;
    return work(this.transactionToken);
  }
  async findReusableSource(_transaction: unknown, candidate: Parameters<KnowledgeIngestionRepository["findReusableSource"]>[1]) {
    const source = this.sources.find((entry) =>
      entry.sourceType === candidate.sourceType &&
      entry.contentHash === candidate.contentHash &&
      entry.name === candidate.name &&
      entry.licenseNote === candidate.licenseNote &&
      entry.publicUrl === candidate.publicUrl &&
      (candidate.inputKind === "text" || entry.objectKey === candidate.objectKey),
    );
    if (!source) return null;
    const job = this.jobs.find((entry) => entry.sourceId === source.id);
    return job ? { sourceId: source.id, jobId: job.id, objectKey: source.objectKey } : null;
  }
  async insertSource(_transaction: unknown, source: Omit<KnowledgeSourceRecord, "id">) {
    const record = { ...source, id: `source-${this.sources.length + 1}` };
    this.sources.push(record);
    return record.id;
  }
  async insertJob(_transaction: unknown, job: Omit<(typeof this.jobs)[number], "id">) {
    const record = { ...job, id: `job-${this.jobs.length + 1}` };
    this.jobs.push(record);
    return record.id;
  }
  async getSourceForReview(_transaction: unknown, sourceId: string) {
    return this.sources.find((source) => source.id === sourceId) ?? null;
  }
  async updateSourceReview(_transaction: unknown, sourceId: string, reviewStatus: "approved" | "rejected") {
    const source = this.sources.find((entry) => entry.id === sourceId);
    if (!source) return null;
    source.reviewStatus = reviewStatus;
    source.retrievalScope = reviewStatus === "approved" ? "production" : "development_only";
    return source;
  }
  async appendSourceReviewEvent(_transaction: unknown, event: (typeof this.sourceReviewEvents)[number]) {
    this.sourceReviewEvents.push(event);
  }
  async getItemForReview(_transaction: unknown, itemId: string) { return this.items.get(itemId) ?? null; }
  async updateItemReview(_transaction: unknown, itemId: string, reviewStatus: "approved" | "rejected", reviewNote: string | null) {
    const item = this.items.get(itemId);
    if (!item) return null;
    item.reviewStatus = reviewStatus;
    item.retrievalScope = reviewStatus === "approved" ? "production" : "development_only";
    return { ...item, reviewNote };
  }
  async appendItemReviewEvent(_transaction: unknown, event: (typeof this.itemReviewEvents)[number]) {
    this.itemReviewEvents.push(event);
  }
  async setItemEnabled(itemId: string, enabled: boolean) {
    const item = this.items.get(itemId);
    if (!item) return null;
    item.enabled = enabled;
    return item;
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const send = vi.fn(async (_payload: { ingestionJobId: string }, transaction: unknown) => {
    expect(transaction).toBe(repository.transactionToken);
  });
  const service = createKnowledgeIngestionService({ repository, storage, queue: { send } });
  return { repository, storage, send, service };
}

describe("knowledge ingestion service", () => {
  test("only an admin can submit knowledge", async () => {
    const { service, storage, send } = fixture();
    await expect(service.enqueue(user, textInput)).rejects.toThrow("FORBIDDEN");
    expect(storage.puts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test("stores manual text privately and creates pending source, job, and queue entry atomically", async () => {
    const { service, repository, storage, send } = fixture();
    const result = await service.enqueue(admin, textInput);

    expect(result).toMatchObject({ sourceId: "source-1", jobId: "job-1", reused: false });
    expect(storage.puts[0]).toMatchObject({ mime: "text/plain", bytes: expect.any(Number) });
    expect(new TextDecoder().decode(storage.puts[0]!.body)).toBe(textInput.text);
    expect(repository.sources[0]).toMatchObject({
      objectKey: expect.stringContaining(`private/user/${admin.userId}/`),
      originalMime: "text/plain",
      sourceType: "manual_text",
      fetchStatus: "pending",
      reviewStatus: "pending",
      retrievalScope: "development_only",
      isDemo: false,
      licenseNote: textInput.licenseNote,
    });
    expect(send).toHaveBeenCalledWith({ ingestionJobId: "job-1" }, repository.transactionToken);
  });

  test("cleans up newly stored manual text when the database transaction fails", async () => {
    const { service, repository, storage } = fixture();
    repository.transactionFailure = new Error("database unavailable");
    await expect(service.enqueue(admin, textInput)).rejects.toThrow("database unavailable");
    expect(storage.deletes).toHaveLength(1);
    expect(storage.objects.size).toBe(0);
  });

  test("reuses only an exact authorized text source and removes the duplicate object", async () => {
    const { service, repository, storage, send } = fixture();
    const first = await service.enqueue(admin, textInput);
    const second = await service.enqueue(admin, textInput);
    const differentLicense = await service.enqueue(admin, {
      ...textInput,
      licenseNote: "不同授权范围",
    });

    expect(second).toEqual({ ...first, reused: true });
    expect(differentLicense.sourceId).not.toBe(first.sourceId);
    expect(repository.sources).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(storage.deletes).toHaveLength(1);
  });

  test("rejects a file object outside the submitting admin prefix", async () => {
    const { service } = fixture();
    await expect(service.enqueue(admin, {
      kind: "file",
      name: "资料.pdf",
      objectKey: "private/user/another-user/secret.pdf",
      mime: "application/pdf",
      size: 100,
      licenseNote: "已授权",
    })).rejects.toThrow("FORBIDDEN");
  });

  test("revalidates the stored file signature before enqueueing", async () => {
    const { service, storage } = fixture();
    const objectKey = `private/user/${admin.userId}/fake.pdf`;
    storage.objects.set(objectKey, new Uint8Array([0x4d, 0x5a, 0x00, 0x00]));
    await expect(service.enqueue(admin, {
      kind: "file",
      name: "资料.pdf",
      objectKey,
      mime: "application/pdf",
      size: 4,
      licenseNote: "已授权",
    })).rejects.toThrow("FILE_SIGNATURE_MISMATCH");
  });

  test("keeps AI-produced items pending and blocks item approval until the source is approved", async () => {
    const { service, repository } = fixture();
    const source = await service.enqueue(admin, textInput);
    repository.sources[0]!.fetchStatus = "fetched";
    repository.items.set("item-1", {
      id: "item-1",
      sourceId: source.sourceId,
      reviewStatus: "pending",
      retrievalScope: "development_only",
      enabled: true,
    });

    await expect(service.reviewItem(admin, "item-1", "approved", "人工确认"))
      .rejects.toThrow("SOURCE_NOT_APPROVED");
    expect(repository.items.get("item-1")).toMatchObject({
      reviewStatus: "pending",
      retrievalScope: "development_only",
    });

    await service.reviewSource(admin, source.sourceId, "approved");
    await expect(service.reviewItem(admin, "item-1", "approved", "人工确认"))
      .resolves.toMatchObject({ reviewStatus: "approved", retrievalScope: "production" });
  });

  test("requires a reason when an admin rejects a source", async () => {
    const { service, repository } = fixture();
    const source = await service.enqueue(admin, textInput);
    repository.sources[0]!.fetchStatus = "fetched";

    await expect(service.reviewSource(admin, source.sourceId, "rejected", ""))
      .rejects.toThrow("REVIEW_REASON_REQUIRED");
    expect(repository.sources[0]!.reviewStatus).toBe("pending");
  });

  test("requires a reason when an admin rejects a knowledge item", async () => {
    const { service, repository } = fixture();
    const source = await service.enqueue(admin, textInput);
    repository.sources[0]!.fetchStatus = "fetched";
    repository.items.set("item-1", {
      id: "item-1",
      sourceId: source.sourceId,
      reviewStatus: "pending",
      retrievalScope: "development_only",
      enabled: true,
    });

    await expect(service.reviewItem(admin, "item-1", "rejected", ""))
      .rejects.toThrow("REVIEW_REASON_REQUIRED");
    expect(repository.items.get("item-1")!.reviewStatus).toBe("pending");
  });

  test("appends the reviewer, reason, and status transition in the source review transaction", async () => {
    const { service, repository } = fixture();
    const source = await service.enqueue(admin, textInput);
    repository.sources[0]!.fetchStatus = "fetched";

    await service.reviewSource(admin, source.sourceId, "approved", "已核验授权与内容质量");

    expect(repository.sourceReviewEvents).toEqual([{
      sourceId: source.sourceId,
      reviewerUserId: admin.userId,
      previousReviewStatus: "pending",
      newReviewStatus: "approved",
      reason: "已核验授权与内容质量",
    }]);
  });

  test("appends the reviewer, reason, and status transition in the item review transaction", async () => {
    const { service, repository } = fixture();
    const source = await service.enqueue(admin, textInput);
    repository.sources[0]!.fetchStatus = "fetched";
    repository.items.set("item-1", {
      id: "item-1",
      sourceId: source.sourceId,
      reviewStatus: "pending",
      retrievalScope: "development_only",
      enabled: true,
    });

    await service.reviewItem(admin, "item-1", "rejected", "内容与来源不一致");

    expect(repository.itemReviewEvents).toEqual([{
      itemId: "item-1",
      sourceId: source.sourceId,
      reviewerUserId: admin.userId,
      previousReviewStatus: "pending",
      newReviewStatus: "rejected",
      reason: "内容与来源不一致",
    }]);
  });

  test("allows an admin to disable a reviewed item without changing its review decision", async () => {
    const { service, repository } = fixture();
    repository.items.set("item-1", {
      id: "item-1",
      sourceId: "source-1",
      reviewStatus: "approved",
      retrievalScope: "production",
      enabled: true,
    });
    await expect(service.setItemEnabled(admin, "item-1", false)).resolves.toMatchObject({
      enabled: false,
      reviewStatus: "approved",
      retrievalScope: "production",
    });
  });
});
