import { createHmac } from "node:crypto";

import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { getDeepSeekStatus } from "@/features/ai/deepseek-settings-service";
import { REVIEW_METRIC_DEFINITIONS } from "@/features/reviews/calculate-metrics";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  contentPlans,
  creationProjects,
  creatorProfiles,
  guestSessions,
  interviewMessages,
  materialReferences,
  materials,
  metricSnapshots,
  positioningSessions,
  promptVersions,
  reviews,
} from "@/server/db/schema";
import { databaseAiJobQueue, type AiJobQueue, type AiQueueTransaction } from "@/server/jobs/queues";
import { enforceRateLimit } from "@/server/security/rate-limit";
import type { AiTaskType } from "./ai-schemas";
import { AiFailure, DEEPSEEK_MODEL } from "./deepseek-client";
import { isTestAiAdapterEnabled } from "./test-ai-adapter";

type AiRunStatus = "draft" | "processing" | "ready" | "failed" | "archived";
type SafeInputMetadata = {
  inputKind: "interview" | "creation_request" | "confirmed_metrics";
  fieldCount: number;
  characterCountBucket: "0" | "1-500" | "501-2000" | "2001+";
};

export type AiSubject = {
  entityId: string;
  inputKind: SafeInputMetadata["inputKind"];
  fieldCount: number;
  characterCount: number;
  hmacPayload: unknown;
};

export type AiRunRecord = {
  id: string;
  owner: CurrentActor;
  taskType: AiTaskType;
  entityId: string;
  idempotencyKey: string;
  model: string;
  promptVersionId: string;
  retrievalRecordId: string | null;
  inputHash: string;
  safeInputMetadata: SafeInputMetadata;
  status: AiRunStatus;
  errorCode: string | null;
  safeErrorDetail: string | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type NewAiRun = Omit<
  AiRunRecord,
  "id" | "owner" | "status" | "errorCode" | "safeErrorDetail" | "durationMs" | "createdAt" | "updatedAt"
>;

export interface AiRunRepository {
  readonly queueTransaction?: AiQueueTransaction;
  transaction<T>(work: (repository: AiRunRepository) => Promise<T>): Promise<T>;
  lockIdempotency(actor: CurrentActor, taskType: AiTaskType, idempotencyKey: string): Promise<void>;
  findOwnedSubject(actor: CurrentActor, taskType: AiTaskType, entityId: string): Promise<AiSubject | null>;
  findActivePrompt(taskType: AiTaskType): Promise<{ id: string; version: number; template: string } | null>;
  findByIdempotency(
    actor: CurrentActor,
    taskType: AiTaskType,
    idempotencyKey: string,
  ): Promise<AiRunRecord | null>;
  consumeGuestQuota(actor: CurrentActor): Promise<void>;
  insert(actor: CurrentActor, input: NewAiRun): Promise<AiRunRecord>;
  get(actor: CurrentActor, aiRunId: string): Promise<AiRunRecord | null>;
}

export type EnqueueAiRunDependencies = {
  repository: AiRunRepository;
  queue: AiJobQueue;
  config: { hmacKey: string };
  hasCredential(userId: string): Promise<boolean>;
  rateLimit?: (actor: CurrentActor) => void;
};

const enqueueInputSchema = z
  .object({
    taskType: z.enum(["profile_extract", "positioning_report", "content_plan", "review_report"]),
    entityId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();
const aiRunIdSchema = z.uuid();

function actorWhere(
  actor: CurrentActor,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

function ownerFromRow(row: { userId: string | null; guestSessionId: string | null }): CurrentActor {
  if (row.userId) return { kind: "user", userId: row.userId, role: "user" };
  if (row.guestSessionId) return { kind: "guest", guestSessionId: row.guestSessionId };
  throw new Error("INVALID_OWNER");
}

function entityIdFromRow(row: typeof aiRuns.$inferSelect) {
  return row.positioningSessionId ?? row.creationProjectId ?? row.reviewId;
}

function toAiRunRecord(row: typeof aiRuns.$inferSelect): AiRunRecord {
  const entityId = entityIdFromRow(row);
  if (!entityId) throw new Error("INVALID_AI_RUN_SUBJECT");
  return {
    id: row.id,
    owner: ownerFromRow(row),
    taskType: row.taskType,
    entityId,
    idempotencyKey: row.idempotencyKey,
    model: row.model,
    promptVersionId: row.promptVersionId,
    retrievalRecordId: row.retrievalRecordId,
    inputHash: row.inputHash,
    safeInputMetadata: row.safeInputMetadata,
    status: row.status,
    errorCode: row.errorCode,
    safeErrorDetail: row.safeErrorDetail,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function subjectValues(taskType: AiTaskType, entityId: string) {
  return {
    positioningSessionId:
      taskType === "profile_extract" || taskType === "positioning_report" ? entityId : null,
    creationProjectId: taskType === "content_plan" ? entityId : null,
    reviewId: taskType === "review_report" ? entityId : null,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function hashAiInputPayload(payload: unknown, hmacKey: string) {
  return createHmac("sha256", hmacKey).update(canonicalJson(payload)).digest("hex");
}

function characterCountBucket(count: number): SafeInputMetadata["characterCountBucket"] {
  if (count <= 0) return "0";
  if (count <= 500) return "1-500";
  if (count <= 2_000) return "501-2000";
  return "2001+";
}

export function createDatabaseAiRunRepository(
  database: CreatorCompassDatabase,
  queueTransaction?: AiQueueTransaction,
): AiRunRepository {
  return {
    queueTransaction,
    async transaction(work) {
      return database.transaction(async (transaction) =>
        work(
          createDatabaseAiRunRepository(
            transaction as unknown as CreatorCompassDatabase,
            transaction as unknown as AiQueueTransaction,
          ),
        ),
      );
    },
    async lockIdempotency(actor, taskType, idempotencyKey) {
      const owner = actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
      await database.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${owner}:${taskType}:${idempotencyKey}`}))`,
      );
    },
    async findOwnedSubject(actor, taskType, entityId) {
      if (taskType === "profile_extract" || taskType === "positioning_report") {
        const [row] = await database
          .select()
          .from(positioningSessions)
          .where(and(eq(positioningSessions.id, entityId), actorWhere(actor, positioningSessions)))
          .limit(1);
        if (!row) return null;
        const messages = await database
          .select({
            id: interviewMessages.id,
            sender: interviewMessages.sender,
            content: interviewMessages.content,
            extractedProfile: interviewMessages.extractedProfile,
          })
          .from(interviewMessages)
          .where(eq(interviewMessages.positioningSessionId, row.id))
          .orderBy(asc(interviewMessages.createdAt), asc(interviewMessages.id));
        const hmacPayload = {
          fingerprintVersion: 1,
          session: {
            draft: row.draft,
            completeness: row.completeness,
            currentStep: row.currentStep,
          },
          messages,
        };
        return {
          entityId: row.id,
          inputKind: "interview",
          fieldCount: Object.keys(row.draft).length + messages.length,
          characterCount: canonicalJson(hmacPayload).length,
          hmacPayload,
        };
      }
      if (taskType === "content_plan") {
        const [row] = await database
          .select()
          .from(creationProjects)
          .where(and(eq(creationProjects.id, entityId), actorWhere(actor, creationProjects)))
          .limit(1);
        if (!row) return null;
        const [profile] = await database
          .select({
            profileDimensions: creatorProfiles.profileDimensions,
            currentPositioning: creatorProfiles.currentPositioning,
            targetAudience: creatorProfiles.targetAudience,
            contentDirection: creatorProfiles.contentDirection,
            platformPreferences: creatorProfiles.platformPreferences,
            materialNotes: creatorProfiles.materialNotes,
            version: creatorProfiles.version,
          })
          .from(creatorProfiles)
          .where(actorWhere(actor, creatorProfiles))
          .limit(1);
        const selectedMaterials = await database
          .select({
            id: materials.id,
            name: materials.name,
            category: materials.category,
            type: materials.type,
            source: materials.source,
            tags: materials.tags,
            summary: materials.summary,
            body: materials.body,
          })
          .from(materialReferences)
          .innerJoin(materials, eq(materialReferences.materialId, materials.id))
          .where(
            and(
              eq(materialReferences.creationProjectId, row.id),
              actorWhere(actor, materialReferences),
            ),
          )
          .orderBy(asc(materials.id));
        const historicalPlans = await database
          .select({
            title: contentPlans.title,
            outline: contentPlans.outline,
            platformSuggestions: contentPlans.platformSuggestions,
            version: contentPlans.version,
            confirmedAt: contentPlans.confirmedAt,
          })
          .from(contentPlans)
          .where(
            and(
              actorWhere(actor, contentPlans),
              eq(contentPlans.status, "ready"),
              isNotNull(contentPlans.confirmedAt),
            ),
          )
          .orderBy(desc(contentPlans.createdAt), desc(contentPlans.id))
          .limit(5);
        const hmacPayload = {
          fingerprintVersion: 1,
          project: {
            contentType: row.contentType,
            platform: row.platform,
            goal: row.goal,
            requirements: row.requirements,
            availableMinutes: row.availableMinutes,
          },
          profile: profile ?? null,
          selectedMaterials,
          historicalPlans,
        };
        return {
          entityId: row.id,
          inputKind: "creation_request",
          fieldCount: 5 + (profile ? 1 : 0) + selectedMaterials.length + historicalPlans.length,
          characterCount: canonicalJson(hmacPayload).length,
          hmacPayload,
        };
      }
      const [row] = await database
        .select()
        .from(reviews)
        .where(and(eq(reviews.id, entityId), actorWhere(actor, reviews)))
        .limit(1);
      if (!row) return null;
      const [snapshot] = await database
        .select({
          id: metricSnapshots.id,
          confirmedMetrics: metricSnapshots.confirmedMetrics,
          calculatedMetrics: metricSnapshots.calculatedMetrics,
          completeness: metricSnapshots.completeness,
          corrections: metricSnapshots.corrections,
          capturedAt: metricSnapshots.capturedAt,
          userConfirmedAt: metricSnapshots.userConfirmedAt,
        })
        .from(metricSnapshots)
        .where(
          and(
            eq(metricSnapshots.reviewId, row.id),
            isNotNull(metricSnapshots.userConfirmedAt),
          ),
        )
        .orderBy(desc(metricSnapshots.userConfirmedAt), desc(metricSnapshots.id))
        .limit(1);
      const hmacPayload = {
        fingerprintVersion: 1,
        review: {
          platform: row.platform,
          contentTitle: row.contentTitle,
          publishedAt: row.publishedAt,
          collectedAt: row.collectedAt,
          sourceMode: row.sourceMode,
        },
        confirmedSnapshot: snapshot ?? null,
        metricDefinitions: REVIEW_METRIC_DEFINITIONS,
      };
      if (!snapshot) throw new Error("REVIEW_METRICS_NOT_CONFIRMED");
      return {
        entityId: row.id,
        inputKind: "confirmed_metrics",
        fieldCount: 5 + (snapshot ? Object.keys(snapshot.confirmedMetrics).length : 0),
        characterCount: canonicalJson(hmacPayload).length,
        hmacPayload,
      };
    },
    async findActivePrompt(taskType) {
      const [row] = await database
        .select({ id: promptVersions.id, version: promptVersions.version, template: promptVersions.template })
        .from(promptVersions)
        .where(and(eq(promptVersions.taskType, taskType), eq(promptVersions.enabled, true)))
        .limit(1);
      return row ?? null;
    },
    async findByIdempotency(actor, taskType, idempotencyKey) {
      const [row] = await database
        .select()
        .from(aiRuns)
        .where(
          and(
            actorWhere(actor, aiRuns),
            eq(aiRuns.taskType, taskType),
            eq(aiRuns.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row ? toAiRunRecord(row) : null;
    },
    async consumeGuestQuota(actor) {
      if (actor.kind !== "guest") return;
      const rows = await database
        .update(guestSessions)
        .set({ aiQuotaUsed: sql`${guestSessions.aiQuotaUsed} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(guestSessions.id, actor.guestSessionId),
            isNull(guestSessions.revokedAt),
            gt(guestSessions.expiresAt, new Date()),
            sql`${guestSessions.aiQuotaUsed} < ${guestSessions.aiQuotaLimit}`,
          ),
        )
        .returning({ id: guestSessions.id });
      if (rows.length !== 1) throw new Error("AI_QUOTA_EXCEEDED");
    },
    async insert(actor, input) {
      const [row] = await database
        .insert(aiRuns)
        .values({
          ...ownerValues(actor),
          ...subjectValues(input.taskType, input.entityId),
          taskType: input.taskType,
          idempotencyKey: input.idempotencyKey,
          model: input.model,
          promptVersionId: input.promptVersionId,
          retrievalRecordId: input.retrievalRecordId,
          inputHash: input.inputHash,
          safeInputMetadata: input.safeInputMetadata,
          status: "processing",
        })
        .returning();
      if (!row) throw new Error("AI_RUN_CREATE_FAILED");
      return toAiRunRecord(row);
    },
    async get(actor, aiRunId) {
      const [row] = await database
        .select()
        .from(aiRuns)
        .where(and(eq(aiRuns.id, aiRunId), actorWhere(actor, aiRuns)))
        .limit(1);
      return row ? toAiRunRecord(row) : null;
    },
  };
}

export const databaseAiRunRepository = createDatabaseAiRunRepository(db);

function environmentDependencies(): EnqueueAiRunDependencies {
  return {
    repository: databaseAiRunRepository,
    queue: databaseAiJobQueue,
    config: { hmacKey: process.env.AI_LOG_HMAC_KEY ?? process.env.AUTH_SECRET ?? "" },
    async hasCredential(userId) {
      if (isTestAiAdapterEnabled()) return true;
      return (await getDeepSeekStatus(userId)).configured;
    },
    rateLimit(actor) {
      enforceRateLimit("ai", actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`);
    },
  };
}

export async function enqueueAiRun(
  actor: CurrentActor,
  input: z.input<typeof enqueueInputSchema>,
  dependencies: EnqueueAiRunDependencies = environmentDependencies(),
) {
  const parsed = enqueueInputSchema.parse(input);
  const { hmacKey } = dependencies.config;
  if (
    actor.kind !== "user" ||
    !hmacKey.trim() ||
    !(await dependencies.hasCredential(actor.userId))
  ) {
    throw new AiFailure("NOT_CONFIGURED", "AI generation is not configured.", false);
  }
  dependencies.rateLimit?.(actor);
  await dependencies.queue.ready?.();
  const ownerSingletonKey = hashAiInputPayload(
    { kind: "user", id: actor.userId },
    hmacKey,
  );

  return dependencies.repository.transaction(async (repository) => {
    await repository.lockIdempotency(actor, parsed.taskType, parsed.idempotencyKey);
    const subject = await repository.findOwnedSubject(actor, parsed.taskType, parsed.entityId);
    if (!subject) throw new Error("NOT_FOUND");
    const hash = hashAiInputPayload(subject.hmacPayload, hmacKey);

    const existing = await repository.findByIdempotency(
      actor,
      parsed.taskType,
      parsed.idempotencyKey,
    );
    if (existing) {
      if (existing.entityId !== subject.entityId || existing.inputHash !== hash) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return { aiRunId: existing.id };
    }

    const prompt = await repository.findActivePrompt(parsed.taskType);
    if (!prompt) throw new Error("PROMPT_NOT_CONFIGURED");
    await repository.consumeGuestQuota(actor);
    const run = await repository.insert(actor, {
      taskType: parsed.taskType,
      entityId: subject.entityId,
      idempotencyKey: parsed.idempotencyKey,
      model: DEEPSEEK_MODEL,
      promptVersionId: prompt.id,
      retrievalRecordId: null,
      inputHash: hash,
      safeInputMetadata: {
        inputKind: subject.inputKind,
        fieldCount: subject.fieldCount,
        characterCountBucket: characterCountBucket(subject.characterCount),
      },
    });
    await dependencies.queue.send(
      parsed.taskType,
      { aiRunId: run.id },
      repository.queueTransaction,
      ownerSingletonKey,
    );
    return { aiRunId: run.id };
  });
}

export async function getAiRun(
  actor: CurrentActor,
  aiRunId: string,
  repository: AiRunRepository = databaseAiRunRepository,
) {
  const parsedId = aiRunIdSchema.parse(aiRunId);
  const run = await repository.get(actor, parsedId);
  if (!run) throw new Error("NOT_FOUND");
  return {
    id: run.id,
    taskType: run.taskType,
    status: run.status,
    errorCode: run.errorCode,
    safeErrorDetail: run.safeErrorDetail,
    durationMs: run.durationMs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
