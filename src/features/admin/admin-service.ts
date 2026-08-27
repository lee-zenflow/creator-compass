import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import {
  aiRuns,
  knowledgeIngestionJobs,
  knowledgeItemReviewEvents,
  knowledgeItems,
  knowledgeSourceReviewEvents,
  knowledgeSources,
  platformRules,
  promptVersions,
  users,
} from "@/server/db/schema";
import { databaseAdminKnowledgeInspectionRepository } from "@/server/search/retrieval-inspection";
import {
  explainKnowledgeRetrieval,
  type AdminKnowledgeInspectionRepository,
  type AdminRetrievalResult,
} from "@/server/search/retrieval-explanation";
import type { RetrievalInput } from "@/server/search/retrieve-knowledge";

type SourceReviewStatus = "pending" | "approved" | "rejected";
type SourceRetrievalScope = "production" | "development_only";

export const ADMIN_SOURCE_LIST_LIMIT = 100;
export const ADMIN_ITEM_LIST_LIMIT = 500;
export const ADMIN_AUDIT_HISTORY_LIMIT = 100;

export type AdminKnowledgeOverview = {
  sources: number;
  pendingSources: number;
  failedSources: number;
  chunks: number;
  pendingChunks: number;
};

export type AdminKnowledgeSource = {
  id: string;
  name: string;
  sourceType: string;
  fetchStatus: "pending" | "fetched" | "failed";
  reviewStatus: SourceReviewStatus;
  retrievalScope: SourceRetrievalScope;
  createdAt: Date;
  processedAt: Date | null;
  failureCode: string | null;
  jobStatus: string | null;
  itemCount: number;
  pendingItemCount: number;
};

export type AdminKnowledgeSourceWindow = {
  rows: AdminKnowledgeSource[];
  total: number;
  hasMore: boolean;
  limit: number;
  reviewOnly: boolean;
};

export type AdminKnowledgeSourceDetail = {
  source: {
    id: string;
    name: string;
    publicUrl: string | null;
    sourceType: string;
    originalMime: string | null;
    fetchStatus: "pending" | "fetched" | "failed";
    licenseNote: string | null;
    failureCode: string | null;
    reviewStatus: SourceReviewStatus;
    retrievalScope: SourceRetrievalScope;
    createdAt: Date;
    processedAt: Date | null;
    allowAiSend: boolean;
    embeddingStatus: "pending" | "ready" | "failed" | "not_requested";
    defaultPlatform: string | null;
    defaultContentType: string | null;
    defaultTags: string[];
  };
  job: { status: string; failureCode: string | null } | null;
  reviewHistory: Array<{
    id: string;
    reviewerName: string;
    previousReviewStatus: SourceReviewStatus;
    newReviewStatus: Exclude<SourceReviewStatus, "pending">;
    reason: string | null;
    createdAt: Date;
  }>;
  itemReviewHistory: Array<{
    id: string;
    itemId: string;
    itemTitle: string;
    chunkIndex: number;
    reviewerName: string;
    previousReviewStatus: SourceReviewStatus;
    newReviewStatus: Exclude<SourceReviewStatus, "pending">;
    reason: string | null;
    createdAt: Date;
  }>;
  itemWindow: { shown: number; total: number; limit: number };
  quality: {
    characters: number;
    chunks: number;
    averageChunkLength: number;
    blank: number;
    short: number;
    long: number;
    duplicate: number;
    missingMetadata: number;
  };
  reviewProgress: { reviewed: number; total: number };
  items: Array<{
    id: string;
    title: string;
    platform: string | null;
    contentType: string | null;
    tags: string[];
    chunkIndex: number;
    excerpt: string;
    reviewStatus: SourceReviewStatus;
    retrievalScope: SourceRetrievalScope;
    reviewNote: string | null;
    enabled: boolean;
    characterCount: number;
    contentHash: string;
  }>;
};

type SourceQualityItem = Pick<
  AdminKnowledgeSourceDetail["items"][number],
  "characterCount" | "contentHash" | "platform" | "contentType" | "tags" | "reviewStatus"
>;

export function buildSourceQuality(items: SourceQualityItem[]) {
  const hashCounts = new Map<string, number>();
  for (const item of items) hashCounts.set(item.contentHash, (hashCounts.get(item.contentHash) ?? 0) + 1);
  const characters = items.reduce((sum, item) => sum + item.characterCount, 0);
  return {
    characters,
    chunks: items.length,
    averageChunkLength: items.length ? Math.round(characters / items.length) : 0,
    blank: items.filter((item) => item.characterCount === 0).length,
    short: items.filter((item) => item.characterCount > 0 && item.characterCount < 80).length,
    long: items.filter((item) => item.characterCount > 800).length,
    duplicate: items.filter((item) => (hashCounts.get(item.contentHash) ?? 0) > 1).length,
    missingMetadata: items.filter((item) => !item.platform || !item.contentType || item.tags.length === 0).length,
    reviewed: items.filter((item) => item.reviewStatus !== "pending").length,
  };
}

export interface AdminRepository {
  listFailedAiRuns(): Promise<Array<Record<string, unknown>>>;
  listKnowledgeSources(options: {
    reviewOnly: boolean;
    limit: number;
  }): Promise<AdminKnowledgeSourceWindow>;
  getKnowledgeSourceDetail(sourceId: string): Promise<AdminKnowledgeSourceDetail | null>;
  getKnowledgeOverviewCounts(): Promise<AdminKnowledgeOverview>;
  listRules(): Promise<Array<Record<string, unknown>>>;
  listPrompts(): Promise<Array<Record<string, unknown>>>;
  activatePromptVersion(promptId: string): Promise<Record<string, unknown>>;
}

export function assertAdmin(actor: CurrentActor): asserts actor is Extract<CurrentActor, { kind: "user" }> {
  if (actor.kind !== "user" || actor.role !== "admin") throw new Error("FORBIDDEN");
}

export const databaseAdminRepository: AdminRepository = {
  async listFailedAiRuns() {
    return db.select({ id: aiRuns.id, taskType: aiRuns.taskType, status: aiRuns.status, durationMs: aiRuns.durationMs, model: aiRuns.model, inputTokens: aiRuns.inputTokens, outputTokens: aiRuns.outputTokens, errorCode: aiRuns.errorCode, createdAt: aiRuns.createdAt })
      .from(aiRuns).where(eq(aiRuns.status, "failed")).orderBy(desc(aiRuns.createdAt)).limit(100);
  },
  async listKnowledgeSources(options) {
    const reviewPredicate = or(
      eq(knowledgeSources.reviewStatus, "pending"),
      sql`exists (
        select 1 from ${knowledgeItems}
        where ${knowledgeItems.knowledgeSourceId} = ${knowledgeSources.id}
          and ${knowledgeItems.reviewStatus} = 'pending'
      )`,
    );
    const where = options.reviewOnly ? reviewPredicate : sql`true`;
    const [sourceRows, [totalRow]] = await Promise.all([
      db.select({
      id: knowledgeSources.id,
      name: knowledgeSources.name,
      sourceType: knowledgeSources.sourceType,
      fetchStatus: knowledgeSources.fetchStatus,
      reviewStatus: knowledgeSources.reviewStatus,
      retrievalScope: knowledgeSources.retrievalScope,
      createdAt: knowledgeSources.createdAt,
      processedAt: knowledgeSources.processedAt,
      allowAiSend: knowledgeSources.allowAiSend,
      embeddingStatus: knowledgeSources.embeddingStatus,
      defaultPlatform: knowledgeSources.defaultPlatform,
      defaultContentType: knowledgeSources.defaultContentType,
      defaultTags: knowledgeSources.defaultTags,
      failureCode: knowledgeSources.failureCode,
      })
        .from(knowledgeSources)
        .where(where)
        .orderBy(desc(knowledgeSources.createdAt))
        .limit(options.limit + 1),
      db.select({ total: sql<number>`count(*)::int` })
        .from(knowledgeSources)
        .where(where),
    ]);
    const hasMore = sourceRows.length > options.limit;
    const sources = sourceRows.slice(0, options.limit);
    if (sources.length === 0) {
      return {
        rows: [],
        total: totalRow?.total ?? 0,
        hasMore,
        limit: options.limit,
        reviewOnly: options.reviewOnly,
      };
    }
    const sourceIds = sources.map((source) => source.id);
    const [jobs, counts] = await Promise.all([
      db.select({ sourceId: knowledgeIngestionJobs.sourceId, status: knowledgeIngestionJobs.status, createdAt: knowledgeIngestionJobs.createdAt })
        .from(knowledgeIngestionJobs).where(inArray(knowledgeIngestionJobs.sourceId, sourceIds)).orderBy(desc(knowledgeIngestionJobs.createdAt)),
      db.select({
        sourceId: knowledgeItems.knowledgeSourceId,
        itemCount: sql<number>`count(*)::int`,
        pendingItemCount: sql<number>`count(*) filter (where ${knowledgeItems.reviewStatus} = 'pending')::int`,
      }).from(knowledgeItems).where(inArray(knowledgeItems.knowledgeSourceId, sourceIds)).groupBy(knowledgeItems.knowledgeSourceId),
    ]);
    const latestJob = new Map<string, string>();
    for (const job of jobs) if (!latestJob.has(job.sourceId)) latestJob.set(job.sourceId, job.status);
    const countsBySource = new Map(counts.map((count) => [count.sourceId, count]));
    const rows = sources.map((source) => ({
      ...source,
      jobStatus: latestJob.get(source.id) ?? null,
      itemCount: countsBySource.get(source.id)?.itemCount ?? 0,
      pendingItemCount: countsBySource.get(source.id)?.pendingItemCount ?? 0,
    }));
    return {
      rows,
      total: totalRow?.total ?? 0,
      hasMore,
      limit: options.limit,
      reviewOnly: options.reviewOnly,
    };
  },
  async getKnowledgeSourceDetail(sourceId) {
    const [source] = await db.select({
      id: knowledgeSources.id,
      name: knowledgeSources.name,
      publicUrl: knowledgeSources.publicUrl,
      sourceType: knowledgeSources.sourceType,
      originalMime: knowledgeSources.originalMime,
      fetchStatus: knowledgeSources.fetchStatus,
      licenseNote: knowledgeSources.licenseNote,
      failureCode: knowledgeSources.failureCode,
      reviewStatus: knowledgeSources.reviewStatus,
      retrievalScope: knowledgeSources.retrievalScope,
      createdAt: knowledgeSources.createdAt,
      processedAt: knowledgeSources.processedAt,
      allowAiSend: knowledgeSources.allowAiSend,
      embeddingStatus: knowledgeSources.embeddingStatus,
      defaultPlatform: knowledgeSources.defaultPlatform,
      defaultContentType: knowledgeSources.defaultContentType,
      defaultTags: knowledgeSources.defaultTags,
    }).from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)).limit(1);
    if (!source) return null;
    const [[job], items, reviewHistory, itemReviewHistory, [itemTotal]] = await Promise.all([
      db.select({ status: knowledgeIngestionJobs.status, failureCode: knowledgeIngestionJobs.failureCode })
        .from(knowledgeIngestionJobs).where(eq(knowledgeIngestionJobs.sourceId, sourceId)).orderBy(desc(knowledgeIngestionJobs.createdAt)).limit(1),
      db.select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        platform: knowledgeItems.platform,
        contentType: knowledgeItems.contentType,
        tags: knowledgeItems.tags,
        chunkIndex: knowledgeItems.chunkIndex,
        excerpt: sql<string>`left(${knowledgeItems.searchableText}, 360)`,
        reviewStatus: knowledgeItems.reviewStatus,
        retrievalScope: knowledgeItems.retrievalScope,
        reviewNote: knowledgeItems.reviewNote,
        enabled: knowledgeItems.enabled,
        characterCount: sql<number>`length(${knowledgeItems.searchableText})::int`,
        contentHash: knowledgeItems.contentHash,
      }).from(knowledgeItems).where(eq(knowledgeItems.knowledgeSourceId, sourceId)).orderBy(knowledgeItems.chunkIndex).limit(ADMIN_ITEM_LIST_LIMIT),
      db.select({
        id: knowledgeSourceReviewEvents.id,
        reviewerName: users.name,
        previousReviewStatus: knowledgeSourceReviewEvents.previousReviewStatus,
        newReviewStatus: knowledgeSourceReviewEvents.newReviewStatus,
        reason: knowledgeSourceReviewEvents.reason,
        createdAt: knowledgeSourceReviewEvents.createdAt,
      })
        .from(knowledgeSourceReviewEvents)
        .innerJoin(users, eq(knowledgeSourceReviewEvents.reviewerUserId, users.id))
        .where(eq(knowledgeSourceReviewEvents.sourceId, sourceId))
        .orderBy(desc(knowledgeSourceReviewEvents.createdAt))
        .limit(ADMIN_AUDIT_HISTORY_LIMIT),
      db.select({
        id: knowledgeItemReviewEvents.id,
        itemId: knowledgeItemReviewEvents.itemId,
        itemTitle: knowledgeItems.title,
        chunkIndex: knowledgeItems.chunkIndex,
        reviewerName: users.name,
        previousReviewStatus: knowledgeItemReviewEvents.previousReviewStatus,
        newReviewStatus: knowledgeItemReviewEvents.newReviewStatus,
        reason: knowledgeItemReviewEvents.reason,
        createdAt: knowledgeItemReviewEvents.createdAt,
      })
        .from(knowledgeItemReviewEvents)
        .innerJoin(knowledgeItems, eq(knowledgeItemReviewEvents.itemId, knowledgeItems.id))
        .innerJoin(users, eq(knowledgeItemReviewEvents.reviewerUserId, users.id))
        .where(eq(knowledgeItemReviewEvents.sourceId, sourceId))
        .orderBy(desc(knowledgeItemReviewEvents.createdAt))
        .limit(ADMIN_AUDIT_HISTORY_LIMIT),
      db.select({ total: sql<number>`count(*)::int` })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.knowledgeSourceId, sourceId)),
    ]);
    const quality = buildSourceQuality(items);
    return {
      source,
      job: job ?? null,
      reviewHistory: reviewHistory.map((event) => ({
        ...event,
        newReviewStatus: event.newReviewStatus as Exclude<SourceReviewStatus, "pending">,
      })),
      itemReviewHistory: itemReviewHistory.map((event) => ({
        ...event,
        newReviewStatus: event.newReviewStatus as Exclude<SourceReviewStatus, "pending">,
      })),
      itemWindow: {
        shown: items.length,
        total: itemTotal?.total ?? 0,
        limit: ADMIN_ITEM_LIST_LIMIT,
      },
      quality: {
        characters: quality.characters,
        chunks: quality.chunks,
        averageChunkLength: quality.averageChunkLength,
        blank: quality.blank,
        short: quality.short,
        long: quality.long,
        duplicate: quality.duplicate,
        missingMetadata: quality.missingMetadata,
      },
      reviewProgress: { reviewed: quality.reviewed, total: quality.chunks },
      items,
    };
  },
  async getKnowledgeOverviewCounts() {
    const [[sourceCounts], [itemCounts]] = await Promise.all([
      db.select({
        sources: sql<number>`count(*)::int`,
        pendingSources: sql<number>`count(*) filter (where ${knowledgeSources.reviewStatus} = 'pending')::int`,
        failedSources: sql<number>`count(*) filter (where ${knowledgeSources.fetchStatus} = 'failed')::int`,
      }).from(knowledgeSources),
      db.select({
        chunks: sql<number>`count(*)::int`,
        pendingChunks: sql<number>`count(*) filter (where ${knowledgeItems.reviewStatus} = 'pending')::int`,
      }).from(knowledgeItems),
    ]);
    return {
      sources: sourceCounts?.sources ?? 0,
      pendingSources: sourceCounts?.pendingSources ?? 0,
      failedSources: sourceCounts?.failedSources ?? 0,
      chunks: itemCounts?.chunks ?? 0,
      pendingChunks: itemCounts?.pendingChunks ?? 0,
    };
  },
  async listRules() {
    return db.select({ id: platformRules.id, platform: platformRules.platform, ruleType: platformRules.ruleType, authority: platformRules.authority, reviewStatus: platformRules.reviewStatus, retrievalScope: platformRules.retrievalScope, enabled: platformRules.enabled })
      .from(platformRules).orderBy(desc(platformRules.createdAt)).limit(100);
  },
  async listPrompts() {
    return db.select({ id: promptVersions.id, taskType: promptVersions.taskType, version: promptVersions.version, enabled: promptVersions.enabled, createdAt: promptVersions.createdAt })
      .from(promptVersions).orderBy(promptVersions.taskType, desc(promptVersions.version));
  },
  async activatePromptVersion(promptId) {
    return db.transaction(async (tx) => {
      const [selected] = await tx.select({ id: promptVersions.id, taskType: promptVersions.taskType })
        .from(promptVersions).where(eq(promptVersions.id, promptId)).for("update");
      if (!selected) throw new Error("PROMPT_NOT_FOUND");
      await tx.update(promptVersions).set({ enabled: false, updatedAt: new Date() }).where(eq(promptVersions.taskType, selected.taskType));
      const [active] = await tx.update(promptVersions).set({ enabled: true, updatedAt: new Date() }).where(eq(promptVersions.id, selected.id)).returning({ id: promptVersions.id, enabled: promptVersions.enabled });
      if (!active) throw new Error("PROMPT_NOT_FOUND");
      return active;
    });
  },
};

export async function listFailedAiRuns(actor: CurrentActor, repository = databaseAdminRepository) { assertAdmin(actor); return repository.listFailedAiRuns(); }
export async function listKnowledgeSources(
  actor: CurrentActor,
  options: { reviewOnly?: boolean } = {},
  repository = databaseAdminRepository,
) {
  assertAdmin(actor);
  return repository.listKnowledgeSources({
    reviewOnly: options.reviewOnly ?? false,
    limit: ADMIN_SOURCE_LIST_LIMIT,
  });
}
export async function listKnowledge(actor: CurrentActor, repository = databaseAdminRepository) { return listKnowledgeSources(actor, {}, repository); }
export async function getKnowledgeSourceDetail(actor: CurrentActor, sourceId: string, repository = databaseAdminRepository) {
  assertAdmin(actor);
  return repository.getKnowledgeSourceDetail(z.string().uuid().parse(sourceId));
}
export async function getKnowledgeOverview(actor: CurrentActor, repository = databaseAdminRepository) {
  assertAdmin(actor);
  return repository.getKnowledgeOverviewCounts();
}
export async function listRules(actor: CurrentActor, repository = databaseAdminRepository) { assertAdmin(actor); return repository.listRules(); }
export async function listPrompts(actor: CurrentActor, repository = databaseAdminRepository) { assertAdmin(actor); return repository.listPrompts(); }
export async function activatePromptVersion(actor: CurrentActor, promptId: string, repository = databaseAdminRepository) {
  assertAdmin(actor);
  return repository.activatePromptVersion(z.string().uuid().parse(promptId));
}

export async function testKnowledgeRetrieval(
  actor: CurrentActor,
  input: RetrievalInput,
  repository: AdminKnowledgeInspectionRepository = databaseAdminKnowledgeInspectionRepository,
): Promise<AdminRetrievalResult> {
  assertAdmin(actor);
  return explainKnowledgeRetrieval(input, repository);
}
