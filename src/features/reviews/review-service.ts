import { and, desc, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import { logSafeAnalyticsFailure, trackProductEvent } from "@/features/analytics/analytics-service";
import type { CurrentActor } from "@/features/identity/current-actor";
import { commitTasks } from "@/features/tasks/task-service";
import { enqueueAiRun } from "@/server/ai/run-ai-task";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { aiRuns, metricSnapshots, reviews } from "@/server/db/schema";
import { assertActorObjectKey } from "@/server/storage/storage";
import { calculateMetrics, type CalculatedMetrics, type ConfirmedMetrics } from "./calculate-metrics";
import { reviewPlatformSchema } from "./review-schemas";
import { getReviewReportVersion } from "./review-read-service";
import type { ReviewReportOutput } from "./review-report-schemas";

type RecordStatus = "draft" | "processing" | "ready" | "failed" | "archived";
type ReviewRecord = { id: string; status: RecordStatus };
type SnapshotRecord = { confirmedMetrics: ConfirmedMetrics };
type SnapshotInput = {
  confirmedMetrics: ConfirmedMetrics;
  calculatedMetrics: CalculatedMetrics;
  completeness: number;
  corrections: Record<string, unknown>;
  capturedAt: Date;
  userConfirmedAt: Date;
};

const confirmedMetricsSchema = z.object({
  views: z.number().int().min(0).max(1_000_000_000),
  likes: z.number().int().min(0).max(1_000_000_000).optional(),
  comments: z.number().int().min(0).max(1_000_000_000).optional(),
  favorites: z.number().int().min(0).max(1_000_000_000).optional(),
  shares: z.number().int().min(0).max(1_000_000_000).optional(),
  followersGained: z.number().int().min(0).max(1_000_000_000).optional(),
}).strict();

const confirmedReviewSchema = z.object({
  platform: reviewPlatformSchema,
  platformAccountId: z.uuid().optional(),
  title: z.string().trim().min(1).max(240),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  sourceMode: z.enum(["manual", "ocr"]),
  metrics: confirmedMetricsSchema,
  privateObjectKey: z.string().trim().min(1).max(500).optional(),
}).strict();

export type ConfirmedReviewInput = z.input<typeof confirmedReviewSchema>;

export interface ReviewRepository {
  transaction<T>(work: (repository: ReviewRepository) => Promise<T>): Promise<T>;
  findMatchingReview(actor: CurrentActor, input: { platform: string; platformAccountId: string | null; title: string; publishedAt: Date | null }): Promise<ReviewRecord | null>;
  createReview(actor: CurrentActor, input: { platform: string; platformAccountId: string | null; title: string; publishedAt: Date | null; collectedAt: Date; sourceMode: "manual" | "ocr" }): Promise<{ id: string }>;
  attachPrivateObject(actor: CurrentActor, reviewId: string, objectKey: string, consentAt: Date): Promise<void>;
  findLatestSnapshot(reviewId: string): Promise<SnapshotRecord | null>;
  insertSnapshot(reviewId: string, input: SnapshotInput): Promise<{ id: string }>;
  findReview(actor: CurrentActor, reviewId: string): Promise<ReviewRecord | null>;
  setReviewStatus(actor: CurrentActor, reviewId: string, status: RecordStatus): Promise<void>;
  findRunByKey(actor: CurrentActor, reviewId: string, idempotencyKey: string): Promise<{ id: string; status: RecordStatus } | null>;
  findRun(actor: CurrentActor, reviewId: string, runId: string): Promise<{ id: string; status: RecordStatus } | null>;
  findActiveRun(actor: CurrentActor, reviewId: string): Promise<{ id: string } | null>;
}

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

function createDatabaseReviewRepository(database: CreatorCompassDatabase): ReviewRepository {
  return {
    transaction(work) {
      return database.transaction((tx) => work(createDatabaseReviewRepository(tx as unknown as CreatorCompassDatabase)));
    },
    async findMatchingReview(actor, input) {
      if (!input.publishedAt) return null;
      const [row] = await database.select({ id: reviews.id, status: reviews.status }).from(reviews)
        .where(and(
          actorWhere(actor, reviews),
          eq(reviews.platform, input.platform),
          input.platformAccountId ? eq(reviews.platformAccountId, input.platformAccountId) : isNull(reviews.platformAccountId),
          eq(reviews.contentTitle, input.title),
          eq(reviews.publishedAt, input.publishedAt),
        )).limit(1).for("update");
      return row ?? null;
    },
    async createReview(actor, input) {
      const [row] = await database.insert(reviews).values({
        ...ownerValues(actor),
        platform: input.platform,
        platformAccountId: input.platformAccountId,
        contentTitle: input.title,
        publishedAt: input.publishedAt,
        collectedAt: input.collectedAt,
        sourceMode: input.sourceMode,
        status: "draft",
      }).returning({ id: reviews.id });
      if (!row) throw new Error("REVIEW_CREATE_FAILED");
      return row;
    },
    async attachPrivateObject(actor, reviewId, objectKey, consentAt) {
      const rows = await database.update(reviews).set({ privateObjectKey: objectKey, screenshotConsentAt: consentAt, updatedAt: new Date() })
        .where(and(eq(reviews.id, reviewId), actorWhere(actor, reviews), isNull(reviews.privateObjectKey), isNull(reviews.screenshotConsentAt)))
        .returning({ id: reviews.id });
      if (rows.length !== 1) throw new Error("PRIVATE_OBJECT_ALREADY_SET");
    },
    async findLatestSnapshot(reviewId) {
      const [row] = await database.select({ confirmedMetrics: metricSnapshots.confirmedMetrics })
        .from(metricSnapshots).where(eq(metricSnapshots.reviewId, reviewId))
        .orderBy(desc(metricSnapshots.userConfirmedAt), desc(metricSnapshots.id)).limit(1);
      return row ? { confirmedMetrics: confirmedMetricsSchema.partial().parse(row.confirmedMetrics) } : null;
    },
    async insertSnapshot(reviewId, input) {
      const [row] = await database.insert(metricSnapshots).values({ reviewId, ...input })
        .returning({ id: metricSnapshots.id });
      if (!row) throw new Error("SNAPSHOT_CREATE_FAILED");
      return row;
    },
    async findReview(actor, reviewId) {
      const [row] = await database.select({ id: reviews.id, status: reviews.status }).from(reviews)
        .where(and(eq(reviews.id, reviewId), actorWhere(actor, reviews))).limit(1).for("update");
      return row ?? null;
    },
    async setReviewStatus(actor, reviewId, status) {
      const rows = await database.update(reviews).set({ status, updatedAt: new Date(), collectedAt: new Date() })
        .where(and(eq(reviews.id, reviewId), actorWhere(actor, reviews))).returning({ id: reviews.id });
      if (rows.length !== 1) throw new Error("REVIEW_NOT_FOUND");
    },
    async findRunByKey(actor, reviewId, idempotencyKey) {
      const [row] = await database.select({ id: aiRuns.id, status: aiRuns.status }).from(aiRuns)
        .where(and(
          eq(aiRuns.reviewId, reviewId), eq(aiRuns.taskType, "review_report"),
          eq(aiRuns.idempotencyKey, idempotencyKey), actorWhere(actor, aiRuns),
        )).limit(1);
      return row ?? null;
    },
    async findRun(actor, reviewId, runId) {
      const [row] = await database.select({ id: aiRuns.id, status: aiRuns.status }).from(aiRuns)
        .where(and(
          eq(aiRuns.id, runId), eq(aiRuns.reviewId, reviewId),
          eq(aiRuns.taskType, "review_report"), actorWhere(actor, aiRuns),
        )).limit(1);
      return row ?? null;
    },
    async findActiveRun(actor, reviewId) {
      const [row] = await database.select({ id: aiRuns.id }).from(aiRuns)
        .where(and(
          eq(aiRuns.reviewId, reviewId), eq(aiRuns.taskType, "review_report"),
          eq(aiRuns.status, "processing"), actorWhere(actor, aiRuns),
        )).limit(1);
      return row ?? null;
    },
  };
}

export const databaseReviewRepository = createDatabaseReviewRepository(db);

export async function createReviewFromConfirmedFields(
  actor: CurrentActor,
  input: ConfirmedReviewInput,
  repository = databaseReviewRepository,
  track: typeof trackProductEvent = trackProductEvent,
) {
  const parsed = confirmedReviewSchema.parse(input);
  if (parsed.privateObjectKey) assertActorObjectKey(actor, parsed.privateObjectKey);
  const publishedAt = parsed.publishedAt ? new Date(parsed.publishedAt) : null;
  const now = new Date();
  const result = await repository.transaction(async (tx) => {
    const existing = await tx.findMatchingReview(actor, {
      platform: parsed.platform, platformAccountId: parsed.platformAccountId ?? null,
      title: parsed.title, publishedAt,
    });
    const review = existing ?? await tx.createReview(actor, {
      platform: parsed.platform, platformAccountId: parsed.platformAccountId ?? null,
      title: parsed.title, publishedAt, collectedAt: now,
      sourceMode: parsed.sourceMode,
    });
    if (parsed.privateObjectKey) await tx.attachPrivateObject(actor, review.id, parsed.privateObjectKey, now);
    const previous = await tx.findLatestSnapshot(review.id);
    const calculatedMetrics = calculateMetrics(parsed.metrics, previous?.confirmedMetrics);
    const available = Object.values(parsed.metrics).filter((value) => value !== undefined).length;
    const snapshot = await tx.insertSnapshot(review.id, {
      confirmedMetrics: parsed.metrics,
      calculatedMetrics,
      completeness: Math.round((available / 6) * 100),
      corrections: {},
      capturedAt: now,
      userConfirmedAt: now,
    });
    if (existing) await tx.setReviewStatus(actor, review.id, "draft");
    return {
      reviewId: review.id,
      snapshotId: snapshot.id,
      calculatedMetrics,
    };
  });
  await track(actor, {
    eventName: "data_acquisition_completed",
    flow: "review",
    metadata: { metricCount: Object.values(parsed.metrics).filter((value) => value !== undefined).length },
  }).catch(logSafeAnalyticsFailure);
  return {
    reviewId: result.reviewId,
    snapshotId: result.snapshotId,
    calculatedMetrics: result.calculatedMetrics,
  };
}

export async function requestReviewReport(
  actor: CurrentActor,
  input: { reviewId: string; idempotencyKey: string },
  dependencies: { repository: ReviewRepository; enqueue: typeof enqueueAiRun } = {
    repository: databaseReviewRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = z.object({
    reviewId: z.uuid(), idempotencyKey: z.string().trim().min(1).max(128),
  }).strict().parse(input);
  const prior = await dependencies.repository.findRunByKey(actor, parsed.reviewId, parsed.idempotencyKey);
  if (prior) return { aiRunId: prior.id, aiStatus: prior.status };
  const review = await dependencies.repository.findReview(actor, parsed.reviewId);
  if (!review) throw new Error("REVIEW_NOT_FOUND");
  const active = await dependencies.repository.findActiveRun(actor, parsed.reviewId);
  if (active) throw new Error("AI_PROCESSING");
  await dependencies.repository.setReviewStatus(actor, parsed.reviewId, "processing");
  try {
    const run = await dependencies.enqueue(actor, {
      taskType: "review_report", entityId: parsed.reviewId, idempotencyKey: parsed.idempotencyKey,
    });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    const otherActive = await dependencies.repository.findActiveRun(actor, parsed.reviewId)
      .catch(() => ({ id: "unknown" }));
    if (!otherActive) await dependencies.repository.setReviewStatus(actor, parsed.reviewId, "draft");
    throw error;
  }
}

export async function retryReviewReport(
  actor: CurrentActor,
  input: { reviewId: string; failedRunId: string },
  dependencies: { repository: ReviewRepository; enqueue: typeof enqueueAiRun } = {
    repository: databaseReviewRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = z.object({ reviewId: z.uuid(), failedRunId: z.uuid() }).strict().parse(input);
  const idempotencyKey = `retry:${parsed.failedRunId}`;
  const prior = await dependencies.repository.findRunByKey(actor, parsed.reviewId, idempotencyKey);
  if (prior) return { aiRunId: prior.id, aiStatus: prior.status };

  await dependencies.repository.transaction(async (repository) => {
    const review = await repository.findReview(actor, parsed.reviewId);
    if (!review) throw new Error("REVIEW_NOT_FOUND");
    const failedRun = await repository.findRun(actor, parsed.reviewId, parsed.failedRunId);
    if (!failedRun || failedRun.status !== "failed") throw new Error("AI_RUN_NOT_RETRYABLE");
    if (await repository.findActiveRun(actor, parsed.reviewId)) throw new Error("AI_PROCESSING");
    await repository.setReviewStatus(actor, parsed.reviewId, "processing");
  });

  try {
    const run = await dependencies.enqueue(actor, {
      taskType: "review_report",
      entityId: parsed.reviewId,
      idempotencyKey,
    });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    const active = await dependencies.repository.findActiveRun(actor, parsed.reviewId)
      .catch(() => ({ id: "unknown" }));
    if (!active) await dependencies.repository.setReviewStatus(actor, parsed.reviewId, "failed");
    throw error;
  }
}

export async function requestReviewTasks(
  actor: CurrentActor,
  input: { reportId: string; version: number; selectedTaskIds: string[] },
  dependencies: {
    loadReport: (actor: CurrentActor, reportId: string, version: number) => Promise<Pick<ReviewReportOutput, "actions">>;
    commit: typeof commitTasks;
  } = { loadReport: getReviewReportVersion, commit: commitTasks },
) {
  const parsed = z.object({
    reportId: z.uuid(), version: z.number().int().positive(),
    selectedTaskIds: z.array(z.uuid()).min(1).max(12),
  }).strict().parse(input);
  const report = await dependencies.loadReport(actor, parsed.reportId, parsed.version);
  const selected = new Set(parsed.selectedTaskIds);
  const allowed = new Set(report.actions.map((action) => action.id));
  if ([...selected].some((id) => !allowed.has(id))) throw new Error("INVALID_TASK_SELECTION");
  return dependencies.commit(actor, {
    sourceReportId: parsed.reportId,
    sourceVersion: parsed.version,
    idempotencyKey: `review:${parsed.reportId}:${parsed.version}`,
    tasks: report.actions.map((task, order) => ({
      clientId: task.id, title: task.title, reason: task.reason, steps: task.steps,
      plannedDate: task.plannedDate, estimatedMinutes: task.estimatedMinutes,
      completionCriteria: task.completionCriteria, priority: task.priority,
      selected: selected.has(task.id), order,
    })),
  });
}
