import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  knowledgeIngestionJobs,
  knowledgeItemReviewEvents,
  knowledgeItems,
  knowledgeSourceReviewEvents,
  knowledgeSources,
} from "@/server/db/schema";
import {
  databaseKnowledgeJobQueue,
  type AiQueueTransaction,
  type KnowledgeJobQueue,
} from "@/server/jobs/queues";
import { getPrivateStorage } from "@/server/storage/local-storage";
import { assertAllowedUpload } from "@/server/security/file-policy";
import {
  assertActorObjectKey,
  type PrivateStorage,
} from "@/server/storage/storage";

import {
  knowledgeIngestionInputSchema,
  type KnowledgeIngestionInput,
} from "./ingestion-contracts";

type ReviewStatus = "pending" | "approved" | "rejected";
type RetrievalScope = "production" | "development_only";
type InputKind = KnowledgeIngestionInput["kind"];

export type KnowledgeSourceRecord = {
  id: string;
  name: string;
  publicUrl: string | null;
  objectKey: string | null;
  originalMime: string | null;
  sourceType: "public_web" | "uploaded_file" | "manual_text";
  fetchStatus: "pending" | "fetched" | "failed";
  licenseNote: string;
  defaultPlatform: string | null;
  defaultContentType: string | null;
  defaultTags: string[];
  allowAiSend: boolean;
  failureCode: string | null;
  reviewStatus: ReviewStatus;
  retrievalScope: RetrievalScope;
  isDemo: false;
  contentHash: string;
  capturedAt: Date;
};

export type ReusableSourceCandidate = Omit<KnowledgeSourceRecord, "id" | "capturedAt"> & {
  inputKind: InputKind;
};

export type KnowledgeItemReviewRecord = {
  id: string;
  sourceId: string;
  reviewStatus: ReviewStatus;
  retrievalScope: RetrievalScope;
  enabled: boolean;
};

export interface KnowledgeIngestionRepository {
  transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
  findReusableSource(
    transaction: unknown,
    candidate: ReusableSourceCandidate,
  ): Promise<{ sourceId: string; jobId: string; objectKey: string | null } | null>;
  insertSource(
    transaction: unknown,
    source: Omit<KnowledgeSourceRecord, "id">,
  ): Promise<string>;
  insertJob(
    transaction: unknown,
    job: {
      sourceId: string;
      submittedByUserId: string;
      inputKind: InputKind;
    },
  ): Promise<string>;
  getSourceForReview(transaction: unknown, sourceId: string): Promise<KnowledgeSourceRecord | null>;
  updateSourceReview(
    transaction: unknown,
    sourceId: string,
    reviewStatus: Exclude<ReviewStatus, "pending">,
    allowAiSend: boolean,
  ): Promise<KnowledgeSourceRecord | null>;
  appendSourceReviewEvent(
    transaction: unknown,
    event: {
      sourceId: string;
      reviewerUserId: string;
      previousReviewStatus: ReviewStatus;
      newReviewStatus: Exclude<ReviewStatus, "pending">;
      reason: string | null;
    },
  ): Promise<void>;
  getItemForReview(transaction: unknown, itemId: string): Promise<KnowledgeItemReviewRecord | null>;
  updateItemReview(
    transaction: unknown,
    itemId: string,
    reviewStatus: Exclude<ReviewStatus, "pending">,
    reviewNote: string | null,
  ): Promise<(KnowledgeItemReviewRecord & { reviewNote: string | null }) | null>;
  appendItemReviewEvent(
    transaction: unknown,
    event: {
      itemId: string;
      sourceId: string;
      reviewerUserId: string;
      previousReviewStatus: ReviewStatus;
      newReviewStatus: Exclude<ReviewStatus, "pending">;
      reason: string | null;
    },
  ): Promise<void>;
  setItemEnabled(itemId: string, enabled: boolean): Promise<KnowledgeItemReviewRecord | null>;
}

function databaseTransaction(transaction: unknown) {
  return transaction as CreatorCompassDatabase;
}

export const databaseKnowledgeIngestionRepository: KnowledgeIngestionRepository = {
  transaction(work) {
    return db.transaction((transaction) => work(transaction));
  },
  async findReusableSource(transaction, candidate) {
    const tx = databaseTransaction(transaction);
    const conditions = [
      eq(knowledgeSources.sourceType, candidate.sourceType),
      eq(knowledgeSources.contentHash, candidate.contentHash),
      eq(knowledgeSources.name, candidate.name),
      eq(knowledgeSources.licenseNote, candidate.licenseNote),
      candidate.publicUrl === null
        ? isNull(knowledgeSources.publicUrl)
        : eq(knowledgeSources.publicUrl, candidate.publicUrl),
      inArray(knowledgeIngestionJobs.status, [
        "queued",
        "fetching",
        "parsing",
        "tagging",
        "pending_review",
      ]),
    ];
    if (candidate.inputKind === "file") {
      conditions.push(
        candidate.objectKey === null
          ? isNull(knowledgeSources.objectKey)
          : eq(knowledgeSources.objectKey, candidate.objectKey),
      );
    }
    const [row] = await tx
      .select({
        sourceId: knowledgeSources.id,
        jobId: knowledgeIngestionJobs.id,
        objectKey: knowledgeSources.objectKey,
      })
      .from(knowledgeSources)
      .innerJoin(
        knowledgeIngestionJobs,
        eq(knowledgeIngestionJobs.sourceId, knowledgeSources.id),
      )
      .where(and(...conditions))
      .orderBy(desc(knowledgeIngestionJobs.createdAt))
      .limit(1);
    return row ?? null;
  },
  async insertSource(transaction, source) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .insert(knowledgeSources)
      .values(source)
      .returning({ id: knowledgeSources.id });
    if (!row) throw new Error("KNOWLEDGE_SOURCE_INSERT_FAILED");
    return row.id;
  },
  async insertJob(transaction, job) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .insert(knowledgeIngestionJobs)
      .values({ ...job, status: "queued" })
      .returning({ id: knowledgeIngestionJobs.id });
    if (!row) throw new Error("KNOWLEDGE_JOB_INSERT_FAILED");
    return row.id;
  },
  async getSourceForReview(transaction, sourceId) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .select({
        id: knowledgeSources.id,
        name: knowledgeSources.name,
        publicUrl: knowledgeSources.publicUrl,
        objectKey: knowledgeSources.objectKey,
        originalMime: knowledgeSources.originalMime,
        sourceType: knowledgeSources.sourceType,
        fetchStatus: knowledgeSources.fetchStatus,
        licenseNote: knowledgeSources.licenseNote,
        defaultPlatform: knowledgeSources.defaultPlatform,
        defaultContentType: knowledgeSources.defaultContentType,
        defaultTags: knowledgeSources.defaultTags,
        allowAiSend: knowledgeSources.allowAiSend,
        failureCode: knowledgeSources.failureCode,
        reviewStatus: knowledgeSources.reviewStatus,
        retrievalScope: knowledgeSources.retrievalScope,
        isDemo: knowledgeSources.isDemo,
        contentHash: knowledgeSources.contentHash,
        capturedAt: knowledgeSources.capturedAt,
      })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId))
      .for("update")
      .limit(1);
    return (row as KnowledgeSourceRecord | undefined) ?? null;
  },
  async updateSourceReview(transaction, sourceId, reviewStatus, allowAiSend) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .update(knowledgeSources)
      .set({
        reviewStatus,
        retrievalScope: reviewStatus === "approved" ? "production" : "development_only",
        allowAiSend: reviewStatus === "approved" && allowAiSend,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSources.id, sourceId))
      .returning();
    return (row as KnowledgeSourceRecord | undefined) ?? null;
  },
  async appendSourceReviewEvent(transaction, event) {
    const tx = databaseTransaction(transaction);
    await tx.insert(knowledgeSourceReviewEvents).values(event);
  },
  async getItemForReview(transaction, itemId) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .select({
        id: knowledgeItems.id,
        sourceId: knowledgeItems.knowledgeSourceId,
        reviewStatus: knowledgeItems.reviewStatus,
        retrievalScope: knowledgeItems.retrievalScope,
        enabled: knowledgeItems.enabled,
      })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, itemId))
      .for("update")
      .limit(1);
    return row ?? null;
  },
  async updateItemReview(transaction, itemId, reviewStatus, reviewNote) {
    const tx = databaseTransaction(transaction);
    const [row] = await tx
      .update(knowledgeItems)
      .set({
        reviewStatus,
        retrievalScope: reviewStatus === "approved" ? "production" : "development_only",
        reviewNote,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeItems.id, itemId))
      .returning({
        id: knowledgeItems.id,
        sourceId: knowledgeItems.knowledgeSourceId,
        reviewStatus: knowledgeItems.reviewStatus,
        retrievalScope: knowledgeItems.retrievalScope,
        enabled: knowledgeItems.enabled,
        reviewNote: knowledgeItems.reviewNote,
      });
    return row ?? null;
  },
  async appendItemReviewEvent(transaction, event) {
    const tx = databaseTransaction(transaction);
    await tx.insert(knowledgeItemReviewEvents).values(event);
  },
  async setItemEnabled(itemId, enabled) {
    const [row] = await db
      .update(knowledgeItems)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(knowledgeItems.id, itemId))
      .returning({
        id: knowledgeItems.id,
        sourceId: knowledgeItems.knowledgeSourceId,
        reviewStatus: knowledgeItems.reviewStatus,
        retrievalScope: knowledgeItems.retrievalScope,
        enabled: knowledgeItems.enabled,
      });
    return row ?? null;
  },
};

function assertAdmin(actor: CurrentActor): asserts actor is Extract<CurrentActor, { kind: "user" }> {
  if (actor.kind !== "user" || actor.role !== "admin") throw new Error("FORBIDDEN");
}

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeReviewNote(reviewStatus: Exclude<ReviewStatus, "pending">, reviewNote: string | null) {
  const normalized = reviewNote?.trim() || null;
  if (reviewStatus === "rejected" && !normalized) throw new Error("REVIEW_REASON_REQUIRED");
  return normalized;
}

function sourceType(input: KnowledgeIngestionInput): KnowledgeSourceRecord["sourceType"] {
  if (input.kind === "url") return "public_web";
  if (input.kind === "file") return "uploaded_file";
  return "manual_text";
}

export function createKnowledgeIngestionService(dependencies: {
  repository: KnowledgeIngestionRepository;
  storage: PrivateStorage;
  queue: KnowledgeJobQueue;
}) {
  const { repository, storage, queue } = dependencies;

  return {
    async enqueue(actor: CurrentActor, rawInput: KnowledgeIngestionInput) {
      assertAdmin(actor);
      const input = knowledgeIngestionInputSchema.parse(rawInput);
      let createdObjectKey: string | null = null;
      let objectKey: string | null = null;
      let bytesForHash: Uint8Array | null = null;

      if (input.kind === "text") {
        const bytes = new TextEncoder().encode(input.text);
        const stored = await storage.put(actor, {
          name: `knowledge-${sha256(bytes).slice(0, 16)}.txt`,
          mime: "text/plain",
          bytes: bytes.byteLength,
          body: bytes,
          signature: bytes.slice(0, 16),
        });
        createdObjectKey = stored.objectKey;
        objectKey = stored.objectKey;
        bytesForHash = bytes;
      } else if (input.kind === "file") {
        assertActorObjectKey(actor, input.objectKey);
        const bytes = await storage.get(actor, input.objectKey);
        if (bytes.byteLength !== input.size) throw new Error("FILE_SIZE_MISMATCH");
        assertAllowedUpload({
          name: input.name,
          mime: input.mime,
          bytes: bytes.byteLength,
          signature: bytes.slice(0, 16),
        });
        objectKey = input.objectKey;
        bytesForHash = bytes;
      }

      const normalizedUrl = input.kind === "url" ? new URL(input.url).toString() : null;
      const contentHash = bytesForHash ? sha256(bytesForHash) : sha256(normalizedUrl!);
      const source: Omit<KnowledgeSourceRecord, "id"> = {
        name: input.name,
        publicUrl: normalizedUrl,
        objectKey,
        originalMime:
          input.kind === "file" ? input.mime : input.kind === "text" ? "text/plain" : null,
        sourceType: sourceType(input),
        fetchStatus: "pending",
        licenseNote: input.licenseNote,
        defaultPlatform: input.platform ?? null,
        defaultContentType: input.contentType ?? null,
        defaultTags: input.tags ?? [],
        allowAiSend: false,
        failureCode: null,
        reviewStatus: "pending",
        retrievalScope: "development_only",
        isDemo: false,
        contentHash,
        capturedAt: new Date(),
      };

      try {
        const result = await repository.transaction(async (transaction) => {
          const reusable = await repository.findReusableSource(transaction, {
            ...source,
            inputKind: input.kind,
          });
          if (reusable) {
            return { sourceId: reusable.sourceId, jobId: reusable.jobId, reused: true as const };
          }
          const sourceId = await repository.insertSource(transaction, source);
          const jobId = await repository.insertJob(transaction, {
            sourceId,
            submittedByUserId: actor.userId,
            inputKind: input.kind,
          });
          await queue.send(
            { ingestionJobId: jobId },
            transaction as AiQueueTransaction,
          );
          return { sourceId, jobId, reused: false as const };
        });
        if (result.reused && createdObjectKey) {
          await storage.delete(actor, createdObjectKey).catch(() => undefined);
        }
        return result;
      } catch (error) {
        if (createdObjectKey) {
          await storage.delete(actor, createdObjectKey).catch(() => undefined);
        }
        throw error;
      }
    },

    async reviewSource(
      actor: CurrentActor,
      sourceId: string,
      reviewStatus: Exclude<ReviewStatus, "pending">,
      reviewNote: string | null = null,
      allowAiSend = false,
    ) {
      assertAdmin(actor);
      const normalizedReviewNote = normalizeReviewNote(reviewStatus, reviewNote);
      return repository.transaction(async (transaction) => {
        const source = await repository.getSourceForReview(transaction, sourceId);
        if (!source) throw new Error("KNOWLEDGE_SOURCE_NOT_FOUND");
        if (reviewStatus === "approved" && source.fetchStatus !== "fetched") {
          throw new Error("SOURCE_NOT_READY");
        }
        const previousReviewStatus = source.reviewStatus;
        const updated = await repository.updateSourceReview(
          transaction,
          sourceId,
          reviewStatus,
          allowAiSend,
        );
        if (!updated) throw new Error("KNOWLEDGE_SOURCE_NOT_FOUND");
        await repository.appendSourceReviewEvent(transaction, {
          sourceId,
          reviewerUserId: actor.userId,
          previousReviewStatus,
          newReviewStatus: reviewStatus,
          reason: normalizedReviewNote,
        });
        return updated;
      });
    },

    async reviewItem(
      actor: CurrentActor,
      itemId: string,
      reviewStatus: Exclude<ReviewStatus, "pending">,
      reviewNote: string | null = null,
    ) {
      assertAdmin(actor);
      const normalizedReviewNote = normalizeReviewNote(reviewStatus, reviewNote);
      return repository.transaction(async (transaction) => {
        const item = await repository.getItemForReview(transaction, itemId);
        if (!item) throw new Error("KNOWLEDGE_ITEM_NOT_FOUND");
        const source = await repository.getSourceForReview(transaction, item.sourceId);
        if (!source) throw new Error("KNOWLEDGE_SOURCE_NOT_FOUND");
        if (
          reviewStatus === "approved" &&
          (source.reviewStatus !== "approved" ||
            source.retrievalScope !== "production" ||
            source.isDemo)
        ) {
          throw new Error("SOURCE_NOT_APPROVED");
        }
        const previousReviewStatus = item.reviewStatus;
        const updated = await repository.updateItemReview(
          transaction,
          itemId,
          reviewStatus,
          normalizedReviewNote,
        );
        if (!updated) throw new Error("KNOWLEDGE_ITEM_NOT_FOUND");
        await repository.appendItemReviewEvent(transaction, {
          itemId,
          sourceId: item.sourceId,
          reviewerUserId: actor.userId,
          previousReviewStatus,
          newReviewStatus: reviewStatus,
          reason: normalizedReviewNote,
        });
        return updated;
      });
    },

    async setItemEnabled(actor: CurrentActor, itemId: string, enabled: boolean) {
      assertAdmin(actor);
      const updated = await repository.setItemEnabled(itemId, enabled);
      if (!updated) throw new Error("KNOWLEDGE_ITEM_NOT_FOUND");
      return updated;
    },
  };
}

function databaseService() {
  return createKnowledgeIngestionService({
    repository: databaseKnowledgeIngestionRepository,
    storage: getPrivateStorage(),
    queue: databaseKnowledgeJobQueue,
  });
}

export function enqueueKnowledgeIngestion(
  actor: CurrentActor,
  input: KnowledgeIngestionInput,
) {
  return databaseService().enqueue(actor, input);
}

export function reviewKnowledgeSource(
  actor: CurrentActor,
  sourceId: string,
  reviewStatus: Exclude<ReviewStatus, "pending">,
  reviewNote: string | null = null,
  allowAiSend = false,
) {
  return databaseService().reviewSource(actor, sourceId, reviewStatus, reviewNote, allowAiSend);
}

export function reviewKnowledgeItem(
  actor: CurrentActor,
  itemId: string,
  reviewStatus: Exclude<ReviewStatus, "pending">,
  reviewNote: string | null = null,
) {
  return databaseService().reviewItem(actor, itemId, reviewStatus, reviewNote);
}

export function setKnowledgeItemEnabled(
  actor: CurrentActor,
  itemId: string,
  enabled: boolean,
) {
  return databaseService().setItemEnabled(actor, itemId, enabled);
}
