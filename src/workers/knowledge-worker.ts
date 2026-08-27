import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { JobResult, JobWithMetadata, PgBoss } from "pg-boss";
import { z } from "zod";

import { db } from "@/server/db/client";
import {
  knowledgeIngestionJobs,
  knowledgeItems,
  knowledgeSources,
} from "@/server/db/schema";
import {
  ensureAiQueueInfrastructure,
  KNOWLEDGE_INGEST_QUEUE,
  type KnowledgeJobPayload,
} from "@/server/jobs/queues";
import { chunkKnowledgeText, type KnowledgeChunk } from "@/server/knowledge/chunk-text";
import { extractKnowledgeText } from "@/server/knowledge/extract-text";
import type { SupportedKnowledgeMime } from "@/server/knowledge/ingestion-contracts";
import { safeFetchKnowledgeUrl, type SafeFetchResult } from "@/server/knowledge/safe-fetch";
import { tagChunksLocally } from "@/server/knowledge/local-tag-knowledge";
import type { KnowledgeTags } from "@/server/knowledge/tag-knowledge";
import { localEmbeddingClient, type EmbeddingResult } from "@/server/search/embedding-client";
import { getPrivateStorage } from "@/server/storage/local-storage";
import type { PrivateStorage } from "@/server/storage/storage";

type KnowledgeJobStatus =
  | "queued"
  | "fetching"
  | "parsing"
  | "tagging"
  | "pending_review"
  | "failed";

export type WorkerKnowledgeJob = {
  id: string;
  sourceId: string;
  submittedByUserId: string;
  inputKind: "url" | "file" | "text";
  status: KnowledgeJobStatus;
  sourceName: string;
  publicUrl: string | null;
  objectKey: string | null;
  originalMime: string | null;
  contentHash: string;
  defaultPlatform: string | null;
  defaultContentType: string | null;
  defaultTags: string[];
};

export type PendingKnowledgeChunk = {
  chunk: KnowledgeChunk;
  tags: KnowledgeTags;
  reviewStatus: "pending";
  retrievalScope: "development_only";
  enabled: true;
  isDemo: false;
  embedding: number[] | null;
  embeddingStatus: "ready" | "failed";
  embeddingModel: string | null;
  embeddingVersion: string | null;
};

export type PersistPendingChunksInput = {
  sourceContentHash: string;
  originalMime: string;
  archivedObjectKey: string | null;
  chunks: PendingKnowledgeChunk[];
};

export interface KnowledgeIngestionWorkerRepository {
  getById(jobId: string): Promise<WorkerKnowledgeJob | null>;
  markStatus(jobId: string, status: "fetching" | "parsing" | "tagging"): Promise<void>;
  persistPendingChunks(jobId: string, input: PersistPendingChunksInput): Promise<void>;
  markFailed(
    jobId: string,
    failure: { failureCode: string; safeFailureDetail: string },
  ): Promise<void>;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export const databaseKnowledgeIngestionWorkerRepository: KnowledgeIngestionWorkerRepository = {
  async getById(jobId) {
    const [row] = await db
      .select({
        id: knowledgeIngestionJobs.id,
        sourceId: knowledgeIngestionJobs.sourceId,
        submittedByUserId: knowledgeIngestionJobs.submittedByUserId,
        inputKind: knowledgeIngestionJobs.inputKind,
        status: knowledgeIngestionJobs.status,
        sourceName: knowledgeSources.name,
        publicUrl: knowledgeSources.publicUrl,
        objectKey: knowledgeSources.objectKey,
        originalMime: knowledgeSources.originalMime,
        contentHash: knowledgeSources.contentHash,
        defaultPlatform: knowledgeSources.defaultPlatform,
        defaultContentType: knowledgeSources.defaultContentType,
        defaultTags: knowledgeSources.defaultTags,
      })
      .from(knowledgeIngestionJobs)
      .innerJoin(knowledgeSources, eq(knowledgeIngestionJobs.sourceId, knowledgeSources.id))
      .where(eq(knowledgeIngestionJobs.id, jobId))
      .limit(1);
    return row ?? null;
  },
  async markStatus(jobId, status) {
    const now = new Date();
    const rows = await db
      .update(knowledgeIngestionJobs)
      .set({
        status,
        ...(status === "fetching" ? { startedAt: now, attempt: 1 } : {}),
        failureCode: null,
        safeFailureDetail: null,
        updatedAt: now,
      })
      .where(eq(knowledgeIngestionJobs.id, jobId))
      .returning({ id: knowledgeIngestionJobs.id });
    if (rows.length !== 1) throw new Error("KNOWLEDGE_JOB_NOT_FOUND");
  },
  async persistPendingChunks(jobId, input) {
    await db.transaction(async (transaction) => {
      const [record] = await transaction
        .select({
          sourceId: knowledgeIngestionJobs.sourceId,
          sourceName: knowledgeSources.name,
          capturedAt: knowledgeSources.capturedAt,
          status: knowledgeIngestionJobs.status,
        })
        .from(knowledgeIngestionJobs)
        .innerJoin(knowledgeSources, eq(knowledgeIngestionJobs.sourceId, knowledgeSources.id))
        .where(eq(knowledgeIngestionJobs.id, jobId))
        .for("update")
        .limit(1);
      if (!record) throw new Error("KNOWLEDGE_JOB_NOT_FOUND");
      if (record.status !== "tagging") throw new Error("KNOWLEDGE_JOB_STATE_CONFLICT");
      if (input.chunks.length === 0) throw new Error("EMPTY_DOCUMENT");

      await transaction.insert(knowledgeItems).values(
        input.chunks.map(({ chunk, tags, embedding, embeddingStatus, embeddingModel, embeddingVersion }) => ({
          knowledgeSourceId: record.sourceId,
          platform: tags.platform,
          contentType: tags.contentType,
          tags: tags.tags,
          title: `${record.sourceName}（片段 ${chunk.index + 1}）`,
          searchableText: [
            chunk.text,
            tags.summary,
            ...tags.normalizedKeywords,
            ...tags.tags,
          ].join(" "),
          chunkIndex: chunk.index,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          structuredConclusion: tags,
          authority: "ai_candidate_pending_review",
          reviewStatus: "pending" as const,
          retrievalScope: "development_only" as const,
          isDemo: false,
          enabled: true,
          contentHash: sha256(chunk.text),
          embedding,
          embeddingStatus,
          embeddingModel,
          embeddingVersion,
          capturedAt: record.capturedAt,
        })),
      );

      await transaction
        .update(knowledgeSources)
        .set({
          fetchStatus: "fetched",
          failureCode: null,
          originalMime: input.originalMime,
          contentHash: input.sourceContentHash,
          ...(input.archivedObjectKey ? { objectKey: input.archivedObjectKey } : {}),
          processedAt: new Date(),
          embeddingStatus: input.chunks.every((chunk) => chunk.embeddingStatus === "ready") ? "ready" : "failed",
          embeddingModel: input.chunks.find((chunk) => chunk.embeddingModel)?.embeddingModel ?? null,
          embeddingVersion: input.chunks.find((chunk) => chunk.embeddingVersion)?.embeddingVersion ?? null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, record.sourceId));
      await transaction
        .update(knowledgeIngestionJobs)
        .set({
          status: "pending_review",
          failureCode: null,
          safeFailureDetail: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeIngestionJobs.id, jobId),
            eq(knowledgeIngestionJobs.status, "tagging"),
          ),
        );
    });
  },
  async markFailed(jobId, failure) {
    await db.transaction(async (transaction) => {
      const [record] = await transaction
        .select({ sourceId: knowledgeIngestionJobs.sourceId })
        .from(knowledgeIngestionJobs)
        .where(eq(knowledgeIngestionJobs.id, jobId))
        .for("update")
        .limit(1);
      if (!record) return;
      const now = new Date();
      await transaction
        .update(knowledgeSources)
        .set({ fetchStatus: "failed", failureCode: failure.failureCode, updatedAt: now })
        .where(eq(knowledgeSources.id, record.sourceId));
      await transaction
        .update(knowledgeIngestionJobs)
        .set({
          status: "failed",
          failureCode: failure.failureCode,
          safeFailureDetail: failure.safeFailureDetail,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(knowledgeIngestionJobs.id, jobId));
    });
  },
};

type TaggedChunk = { chunk: KnowledgeChunk; tags: KnowledgeTags };

export type KnowledgeProcessingDependencies = {
  repository: KnowledgeIngestionWorkerRepository;
  storage: PrivateStorage;
  safeFetch(value: string | URL): Promise<SafeFetchResult>;
  tagChunks(
    chunks: readonly KnowledgeChunk[],
    defaults: { platform: string | null; contentType: string | null; tags: readonly string[] },
  ): Promise<TaggedChunk[]>;
  embedChunks?(texts: readonly string[]): Promise<EmbeddingResult>;
};

type ProcessingPhase = "loading" | "fetching" | "parsing" | "tagging" | "persisting";

const SAFE_FAILURE_DETAILS: Record<string, string> = {
  KNOWLEDGE_JOB_NOT_FOUND: "Knowledge ingestion record no longer exists.",
  KNOWLEDGE_JOB_STATE_CONFLICT: "Knowledge ingestion record is not in a processable state.",
  URL_INVALID: "Knowledge URL was invalid.",
  URL_DNS_EMPTY: "Knowledge URL could not be resolved.",
  URL_PRIVATE_ADDRESS: "Knowledge URL resolved to a blocked address.",
  URL_TOO_MANY_REDIRECTS: "Knowledge URL redirected too many times.",
  URL_REDIRECT_INVALID: "Knowledge URL returned an invalid redirect.",
  URL_TIMEOUT: "Knowledge URL fetch timed out.",
  URL_RESPONSE_TOO_LARGE: "Knowledge URL response exceeded the size limit.",
  URL_HTTP_ERROR: "Knowledge URL returned an unsuccessful response.",
  URL_UNSUPPORTED_CONTENT_TYPE: "Knowledge URL returned an unsupported content type.",
  UNSUPPORTED_CONTENT_TYPE: "Knowledge document type is unsupported.",
  INVALID_TEXT_ENCODING: "Knowledge text was not valid UTF-8.",
  DOCUMENT_PARSE_FAILED: "Knowledge document could not be parsed.",
  DOCUMENT_TEXT_TOO_LARGE: "Extracted knowledge text exceeded the size limit.",
  DOCUMENT_TOO_MANY_PAGES: "Knowledge PDF exceeded the page limit.",
  EMPTY_DOCUMENT: "Knowledge document did not contain readable text.",
  STORAGE_READ_FAILED: "Knowledge source could not be read from private storage.",
  AI_NOT_CONFIGURED: "Knowledge tagging is not configured.",
  AI_RATE_LIMITED: "Knowledge tagging service is temporarily busy.",
  AI_TIMEOUT: "Knowledge tagging timed out.",
  AI_INVALID_OUTPUT: "Knowledge tagging output did not match the required format.",
  AI_UPSTREAM_ERROR: "Knowledge tagging service failed.",
  INGESTION_PERSIST_FAILED: "Knowledge ingestion result could not be saved.",
};

function safeFailure(error: unknown, phase: ProcessingPhase) {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_FAILURE_DETAILS[message]) {
    return {
      failureCode: message,
      safeFailureDetail: SAFE_FAILURE_DETAILS[message],
      retryable: ["URL_TIMEOUT", "URL_HTTP_ERROR"].includes(message),
    };
  }
  const failureCode =
    phase === "loading" ? "STORAGE_READ_FAILED" :
      phase === "persisting" ? "INGESTION_PERSIST_FAILED" :
        phase === "tagging" ? "AI_UPSTREAM_ERROR" :
          "DOCUMENT_PARSE_FAILED";
  return {
    failureCode,
    safeFailureDetail: SAFE_FAILURE_DETAILS[failureCode],
    retryable: phase === "loading" || phase === "persisting" || phase === "tagging",
  };
}

class KnowledgeIngestionFailure extends Error {
  readonly retryable: boolean;

  constructor(failure: ReturnType<typeof safeFailure>) {
    super(failure.failureCode);
    this.name = "KnowledgeIngestionFailure";
    this.retryable = failure.retryable;
  }
}

function supportedMime(value: string | null): SupportedKnowledgeMime {
  if (
    value === "text/plain" ||
    value === "text/html" ||
    value === "application/pdf" ||
    value === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return value;
  }
  throw new Error("UNSUPPORTED_CONTENT_TYPE");
}

export async function processKnowledgeIngestion(
  jobId: string,
  dependencies: KnowledgeProcessingDependencies,
) {
  const { repository, storage } = dependencies;
  let phase: ProcessingPhase = "loading";
  let archivedObjectKey: string | null = null;
  let actor: { kind: "user"; userId: string; role: "admin" } | null = null;
  try {
    const job = await repository.getById(jobId);
    if (!job) throw new Error("KNOWLEDGE_JOB_NOT_FOUND");
    if (job.status === "pending_review") return;
    if (!(["queued", "failed"] as KnowledgeJobStatus[]).includes(job.status)) {
      throw new Error("KNOWLEDGE_JOB_STATE_CONFLICT");
    }
    actor = { kind: "user", userId: job.submittedByUserId, role: "admin" };

    await repository.markStatus(jobId, "fetching");
    phase = "fetching";
    let bytes: Uint8Array;
    let mime: SupportedKnowledgeMime;
    if (job.inputKind === "url") {
      if (!job.publicUrl) throw new Error("URL_INVALID");
      const fetched = await dependencies.safeFetch(job.publicUrl);
      bytes = fetched.bytes;
      mime = supportedMime(
        fetched.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? null,
      );
    } else {
      if (!job.objectKey) throw new Error("STORAGE_READ_FAILED");
      phase = "loading";
      bytes = await storage.get(actor, job.objectKey);
      mime = supportedMime(job.originalMime);
    }

    await repository.markStatus(jobId, "parsing");
    phase = "parsing";
    const text = await extractKnowledgeText({ mime, bytes });
    if (!text) throw new Error("EMPTY_DOCUMENT");

    if (job.inputKind === "url") {
      const archiveBytes = new TextEncoder().encode(text);
      const archived = await storage.put(actor, {
        name: `knowledge-${job.sourceId}.txt`,
        mime: "text/plain",
        bytes: archiveBytes.byteLength,
        body: archiveBytes,
        signature: archiveBytes.slice(0, 16),
      });
      archivedObjectKey = archived.objectKey;
    }

    const chunks = chunkKnowledgeText(text);
    if (chunks.length === 0) throw new Error("EMPTY_DOCUMENT");
    await repository.markStatus(jobId, "tagging");
    phase = "tagging";
    const tagged = await dependencies.tagChunks(chunks, {
      platform: job.defaultPlatform,
      contentType: job.defaultContentType,
      tags: job.defaultTags,
    });
    let embedded: EmbeddingResult | null = null;
    try {
      embedded = dependencies.embedChunks
        ? await dependencies.embedChunks(tagged.map(({ chunk, tags }) => [
            chunk.text,
            tags.summary,
            ...tags.normalizedKeywords,
            ...tags.tags,
          ].join(" ")))
        : null;
    } catch {
      embedded = null;
    }
    phase = "persisting";
    await repository.persistPendingChunks(jobId, {
      sourceContentHash: job.inputKind === "url" ? sha256(text) : job.contentHash,
      originalMime: mime,
      archivedObjectKey,
      chunks: tagged.map(({ chunk, tags }, index) => ({
        chunk,
        tags,
        reviewStatus: "pending",
        retrievalScope: "development_only",
        enabled: true,
        isDemo: false,
        embedding: embedded?.vectors[index] ?? null,
        embeddingStatus: embedded?.vectors[index] ? "ready" : "failed",
        embeddingModel: embedded?.model ?? null,
        embeddingVersion: embedded?.version ?? null,
      })),
    });
  } catch (error) {
    if (archivedObjectKey && actor) {
      await storage.delete(actor, archivedObjectKey).catch(() => undefined);
    }
    const failure = safeFailure(error, phase);
    await repository.markFailed(jobId, {
      failureCode: failure.failureCode,
      safeFailureDetail: failure.safeFailureDetail,
    }).catch(() => undefined);
    throw new KnowledgeIngestionFailure(failure);
  }
}

const knowledgeJobPayloadSchema = z
  .object({ ingestionJobId: z.uuid() })
  .strict();

export type KnowledgeWorkerQueueJob = {
  id: string;
  data: unknown;
  retryCount: number;
  retryLimit: number;
};

export async function handleKnowledgeJob(
  job: KnowledgeWorkerQueueJob,
  dependencies: KnowledgeProcessingDependencies,
): Promise<JobResult> {
  const payload = knowledgeJobPayloadSchema.safeParse(job.data);
  if (!payload.success) return { id: job.id, status: "deadletter" };
  try {
    await processKnowledgeIngestion(payload.data.ingestionJobId, dependencies);
    return { id: job.id, status: "completed" };
  } catch (error) {
    const retryable = error instanceof KnowledgeIngestionFailure
      ? error.retryable
      : error instanceof Error && ["URL_TIMEOUT", "URL_HTTP_ERROR"].includes(error.message);
    return {
      id: job.id,
      status: retryable && job.retryCount < job.retryLimit ? "failed" : "deadletter",
    };
  }
}

function toQueueJob(job: JobWithMetadata<KnowledgeJobPayload>): KnowledgeWorkerQueueJob {
  return {
    id: job.id,
    data: job.data,
    retryCount: job.retryCount,
    retryLimit: job.retryLimit,
  };
}

export async function startKnowledgeWorker(
  boss: PgBoss,
  repository: KnowledgeIngestionWorkerRepository = databaseKnowledgeIngestionWorkerRepository,
  overrides: Partial<Omit<KnowledgeProcessingDependencies, "repository">> = {},
) {
  await ensureAiQueueInfrastructure(boss);
  const dependencies: KnowledgeProcessingDependencies = {
    repository,
    storage: overrides.storage ?? getPrivateStorage(),
    safeFetch: overrides.safeFetch ?? safeFetchKnowledgeUrl,
    tagChunks: overrides.tagChunks ?? tagChunksLocally,
    embedChunks: overrides.embedChunks ?? ((texts) => localEmbeddingClient.embedDocuments(texts)),
  };
  const workOptions = {
    includeMetadata: true,
    perJobResults: true,
    batchSize: 2,
  } as const;
  await boss.work<KnowledgeJobPayload, JobResult[], typeof workOptions>(
    KNOWLEDGE_INGEST_QUEUE,
    workOptions,
    async (jobs) => Promise.all(jobs.map((job) => handleKnowledgeJob(toQueueJob(job), dependencies))),
  );
  return {
    async stop() {
      await boss.offWork(KNOWLEDGE_INGEST_QUEUE);
    },
  };
}
