import { pathToFileURL } from "node:url";

import { and, eq, sql } from "drizzle-orm";
import type { JobResult, JobWithMetadata, PgBoss } from "pg-boss";
import { z } from "zod";

import { positioningAiTaskHandlers } from "@/features/positioning/positioning-ai-processor";
import { creationAiTaskHandlers } from "@/features/creation/creation-ai-processor";
import { reviewAiTaskHandlers } from "@/features/reviews/review-ai-processor";
import type { AiTaskType } from "@/server/ai/ai-schemas";
import { AiFailure, type AiFailureCode } from "@/server/ai/deepseek-client";
import { cleanupExpiredAiMetadata } from "@/server/ai/retention";
import { closeDatabase, db, type CreatorCompassDatabase } from "@/server/db/client";
import { aiRuns } from "@/server/db/schema";
import { getBoss, stopBoss } from "@/server/jobs/boss";
import { touchWorkerHeartbeat } from "@/server/health/health-service";
import {
  AI_QUEUE_NAMES,
  ensureAiQueueInfrastructure,
  type AiJobPayload,
} from "@/server/jobs/queues";
import { startKnowledgeWorker } from "./knowledge-worker";

export type WorkerAiRun = {
  id: string;
  taskType: AiTaskType;
  status: "draft" | "processing" | "ready" | "failed" | "archived";
  createdAt?: Date;
};

export type AiTaskFinalization = {
  persist(transaction: CreatorCompassDatabase): Promise<void>;
};

export interface AiWorkerRepository {
  getById(aiRunId: string): Promise<WorkerAiRun | null>;
  finalizeSuccess(
    aiRunId: string,
    finalization: AiTaskFinalization,
    metadata: { durationMs: number },
  ): Promise<boolean>;
  markFailed(
    aiRunId: string,
    metadata: {
      errorCode: string | null;
      safeErrorDetail: string | null;
      durationMs?: number;
    },
    finalization?: AiTaskFinalization,
  ): Promise<boolean>;
}

export type AiTaskProcessor = (
  run: WorkerAiRun,
  signal: AbortSignal,
) => Promise<AiTaskFinalization>;

export type AiTaskHandler = {
  process: AiTaskProcessor;
  onTerminalFailure?: (run: WorkerAiRun) => Promise<AiTaskFinalization>;
};

export type AiTaskHandlerMap = Partial<Record<AiTaskType, AiTaskHandler>>;

export type AiWorkerJob = {
  id: string;
  data: unknown;
  retryCount: number;
  retryLimit: number;
  signal: AbortSignal;
};

export const databaseAiWorkerRepository: AiWorkerRepository = {
  async getById(aiRunId) {
    const [row] = await db
      .select({ id: aiRuns.id, taskType: aiRuns.taskType, status: aiRuns.status, createdAt: aiRuns.createdAt })
      .from(aiRuns)
      .where(eq(aiRuns.id, aiRunId))
      .limit(1);
    return row ?? null;
  },
  async finalizeSuccess(aiRunId, finalization, metadata) {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select "id" from "ai_runs" where "id" = ${aiRunId} for update`);
      const [current] = await transaction
        .select({ status: aiRuns.status })
        .from(aiRuns)
        .where(eq(aiRuns.id, aiRunId))
        .limit(1);
      if (current?.status === "ready") return true;
      if (current?.status !== "processing") return false;
      await finalization.persist(transaction as unknown as CreatorCompassDatabase);
      const rows = await transaction
        .update(aiRuns)
        .set({
          status: "ready",
          errorCode: null,
          safeErrorDetail: null,
          durationMs: metadata.durationMs,
          updatedAt: new Date(),
        })
        .where(and(eq(aiRuns.id, aiRunId), eq(aiRuns.status, "processing")))
        .returning({ id: aiRuns.id });
      return rows.length === 1;
    });
  },
  async markFailed(aiRunId, metadata, finalization) {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select "id" from "ai_runs" where "id" = ${aiRunId} for update`);
      const [current] = await transaction
        .select({ status: aiRuns.status })
        .from(aiRuns)
        .where(eq(aiRuns.id, aiRunId))
        .limit(1);
      if (current?.status === "failed") return true;
      if (current?.status !== "processing") return false;
      await finalization?.persist(transaction as unknown as CreatorCompassDatabase);
      const rows = await transaction
        .update(aiRuns)
        .set({
          status: "failed",
          errorCode: metadata.errorCode,
          safeErrorDetail: metadata.safeErrorDetail,
          durationMs: metadata.durationMs,
          updatedAt: new Date(),
        })
        .where(and(eq(aiRuns.id, aiRunId), eq(aiRuns.status, "processing")))
        .returning({ id: aiRuns.id });
      return rows.length === 1;
    });
  },
};

const aiJobPayloadSchema = z.object({ aiRunId: z.uuid() }).strict();

const SAFE_FAILURE_DETAILS: Record<AiFailureCode, string> = {
  NOT_CONFIGURED: "AI generation is not configured.",
  RATE_LIMITED: "AI service is temporarily busy.",
  TIMEOUT: "AI generation timed out.",
  INVALID_OUTPUT: "AI response did not match the required format.",
  UPSTREAM_ERROR: "AI service request failed.",
};

export async function handleAiJob(
  job: AiWorkerJob,
  repository: AiWorkerRepository,
  handler: AiTaskHandler | AiTaskProcessor,
): Promise<JobResult> {
  const startedAt = Date.now();
  const payload = aiJobPayloadSchema.safeParse(job.data);
  if (!payload.success) return { id: job.id, status: "deadletter" };
  const run = await repository.getById(payload.data.aiRunId);
  if (!run) return { id: job.id, status: "deadletter" };
  if (run.status === "ready") return { id: job.id, status: "completed" };
  if (run.status !== "processing") return { id: job.id, status: "deadletter" };

  try {
    const processor = typeof handler === "function" ? handler : handler.process;
    const finalization = await processor(run, job.signal);
    const finalized = await repository.finalizeSuccess(run.id, finalization, {
      durationMs: Date.now() - startedAt,
    });
    return { id: job.id, status: finalized ? "completed" : "deadletter" };
  } catch (error) {
    const failure =
      error instanceof AiFailure
        ? error
        : new AiFailure("UPSTREAM_ERROR", "Unexpected AI task failure.", true);
    const finalAttempt = job.retryCount >= job.retryLimit;
    if (failure.retryable && !finalAttempt) {
      return { id: job.id, status: "failed" };
    }
    const failureFinalization =
      typeof handler === "function" ? undefined : await handler.onTerminalFailure?.(run);
    await repository.markFailed(
      run.id,
      {
        errorCode: failure.code,
        safeErrorDetail: SAFE_FAILURE_DETAILS[failure.code],
        durationMs: Date.now() - startedAt,
      },
      failureFinalization,
    );
    return { id: job.id, status: "deadletter" };
  }
}

function toWorkerJob(job: JobWithMetadata<AiJobPayload>, shutdownSignal: AbortSignal): AiWorkerJob {
  return {
    id: job.id,
    data: job.data,
    retryCount: job.retryCount,
    retryLimit: job.retryLimit,
    signal: AbortSignal.any([job.signal, shutdownSignal]),
  };
}

export async function startAiWorker(
  handlers: AiTaskHandlerMap,
  repository: AiWorkerRepository = databaseAiWorkerRepository,
  boss?: PgBoss,
) {
  const usesGlobalBoss = boss === undefined;
  const activeBoss = boss ?? getBoss();
  await ensureAiQueueInfrastructure(activeBoss);
  const shutdown = new AbortController();
  const workOptions = { includeMetadata: true, perJobResults: true, batchSize: 4 } as const;
  const registeredQueues: string[] = [];
  for (const [taskType, handler] of Object.entries(handlers) as Array<[AiTaskType, AiTaskHandler]>) {
    const queueName = AI_QUEUE_NAMES[taskType];
    await activeBoss.work<AiJobPayload, JobResult[], typeof workOptions>(
      queueName,
      workOptions,
      async (jobs) =>
        Promise.all(
          jobs.map((job) => handleAiJob(toWorkerJob(job, shutdown.signal), repository, handler)),
        ),
    );
    registeredQueues.push(queueName);
  }

  return {
    async stop() {
      shutdown.abort();
      await Promise.all(registeredQueues.map((queueName) => activeBoss.offWork(queueName)));
      if (usesGlobalBoss) await stopBoss();
    },
  };
}

export async function runAiWorkerBootstrap() {
  let finish!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => { finish = resolve; });
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
  let retentionTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let worker: Awaited<ReturnType<typeof startAiWorker>> | null = null;
  let knowledgeWorker: Awaited<ReturnType<typeof startKnowledgeWorker>> | null = null;
  try {
    await cleanupExpiredAiMetadata().catch(() => ({ aiRunsDeleted: 0, retrievalRecordsDeleted: 0 }));
    const boss = getBoss();
    worker = await startAiWorker({
      ...positioningAiTaskHandlers,
      ...creationAiTaskHandlers,
      ...reviewAiTaskHandlers,
    }, databaseAiWorkerRepository, boss);
    knowledgeWorker = await startKnowledgeWorker(boss);
    await touchWorkerHeartbeat();
    heartbeatTimer = setInterval(() => {
      void touchWorkerHeartbeat().catch(() => undefined);
    }, 15_000);
    heartbeatTimer.unref();
    retentionTimer = setInterval(() => {
      void cleanupExpiredAiMetadata().catch(() => undefined);
    }, 24 * 60 * 60 * 1_000);
    retentionTimer.unref();
    await shutdownRequested;
  } finally {
    if (retentionTimer) clearInterval(retentionTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    process.removeListener("SIGINT", finish);
    process.removeListener("SIGTERM", finish);
    await Promise.allSettled([
      worker?.stop(),
      knowledgeWorker?.stop(),
    ]);
    await Promise.allSettled([stopBoss(), closeDatabase()]);
  }
}

const invokedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedFile === import.meta.url) {
  void runAiWorkerBootstrap().catch(() => {
    process.exitCode = 1;
  });
}
