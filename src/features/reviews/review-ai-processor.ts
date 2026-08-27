import { and, desc, eq } from "drizzle-orm";

import { assertAiInputHashMatches, executeAiTaskGeneration, type AiGeneratedResult } from "@/server/ai/execute-ai-task";
import { AiFailure } from "@/server/ai/deepseek-client";
import { createDatabaseAiRunRepository } from "@/server/ai/run-ai-task";
import type { CreatorCompassDatabase } from "@/server/db/client";
import { aiRuns, reports, retrievalRecords, reviewReports, reviews } from "@/server/db/schema";
import type { AiTaskHandler, WorkerAiRun } from "@/workers/ai-worker";
import {
  assertReviewCitationsAllowed,
  normalizeReviewReportOutput,
  type ReviewReportOutput,
} from "./review-report-schemas";

export type ReviewProcessorDependencies = {
  generate(aiRunId: string, signal: AbortSignal): Promise<AiGeneratedResult>;
  persistReviewReport(transaction: CreatorCompassDatabase, run: WorkerAiRun, output: ReviewReportOutput): Promise<void>;
  releaseReview(transaction: CreatorCompassDatabase, run: WorkerAiRun): Promise<void>;
};

function ownerValues(row: { userId: string | null; guestSessionId: string | null }) {
  if (row.userId) return { userId: row.userId, guestSessionId: null };
  if (row.guestSessionId) return { userId: null, guestSessionId: row.guestSessionId };
  throw new Error("INVALID_OWNER");
}

function actorFromRow(row: { userId: string | null; guestSessionId: string | null }) {
  if (row.userId) return { kind: "user" as const, userId: row.userId, role: "user" as const };
  if (row.guestSessionId) return { kind: "guest" as const, guestSessionId: row.guestSessionId };
  throw new Error("INVALID_OWNER");
}

function inputHmacKey() {
  return process.env.AI_LOG_HMAC_KEY ?? process.env.AUTH_SECRET ?? "";
}

async function persistReviewReport(
  transaction: CreatorCompassDatabase,
  run: WorkerAiRun,
  output: ReviewReportOutput,
) {
  const [row] = await transaction.select({
    id: aiRuns.id, userId: aiRuns.userId, guestSessionId: aiRuns.guestSessionId,
    reviewId: aiRuns.reviewId, taskType: aiRuns.taskType, model: aiRuns.model,
    promptVersionId: aiRuns.promptVersionId, retrievalRecordId: aiRuns.retrievalRecordId,
    inputHash: aiRuns.inputHash,
  }).from(aiRuns).where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "processing"))).limit(1);
  if (!row || row.taskType !== "review_report" || !row.reviewId || !row.retrievalRecordId) {
    throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
  }
  const actor = actorFromRow(row);
  const subject = await createDatabaseAiRunRepository(transaction)
    .findOwnedSubject(actor, "review_report", row.reviewId);
  if (!subject) throw new AiFailure("INVALID_OUTPUT", "AI_RUN_SUBJECT_NOT_FOUND", false);
  assertAiInputHashMatches(row.inputHash, subject.hmacPayload, inputHmacKey());

  const [review] = await transaction.select({ title: reviews.contentTitle })
    .from(reviews).where(eq(reviews.id, row.reviewId)).limit(1);
  const [retrieval] = await transaction.select({ hits: retrievalRecords.hits }).from(retrievalRecords)
    .where(eq(retrievalRecords.id, row.retrievalRecordId)).limit(1);
  if (!review || !retrieval) throw new AiFailure("INVALID_OUTPUT", "REVIEW_CONTEXT_MISSING", false);
  try {
    assertReviewCitationsAllowed(output, retrieval.hits.filter((hit) => hit.selected).map((hit) => ({ itemId: hit.itemId, sourceId: hit.sourceId })));
  } catch {
    throw new AiFailure("INVALID_OUTPUT", "INVALID_CITATION", false);
  }

  const [latest] = await transaction.select({ reportId: reviewReports.reportId, version: reviewReports.version })
    .from(reviewReports).where(eq(reviewReports.reviewId, row.reviewId))
    .orderBy(desc(reviewReports.version)).limit(1).for("update");
  let reportId = latest?.reportId;
  if (!reportId) {
    const [root] = await transaction.insert(reports).values({
      ...ownerValues(row), type: "review", title: `${review.title}复盘`,
      summary: "已确认数据、计算指标与下一轮行动", status: "ready",
    }).returning({ id: reports.id });
    reportId = root?.id;
  }
  if (!reportId) throw new Error("REVIEW_REPORT_ROOT_CREATE_FAILED");
  await transaction.insert(reviewReports).values({
    ...ownerValues(row), reportId, reviewId: row.reviewId,
    dataSummary: output.dataSummary, keep: output.retained, problems: output.problems,
    causes: output.causes, recommendations: output.actions, citations: output.citations,
    model: row.model, promptVersionId: row.promptVersionId,
    retrievalRecordId: row.retrievalRecordId, aiRunId: row.id,
    generationMode: "ai", version: (latest?.version ?? 0) + 1, status: "ready",
  });
  await transaction.update(reports).set({ status: "ready", updatedAt: new Date() })
    .where(eq(reports.id, reportId));
  const updated = await transaction.update(reviews).set({ status: "ready", updatedAt: new Date() })
    .where(and(eq(reviews.id, row.reviewId), eq(reviews.status, "processing")))
    .returning({ id: reviews.id });
  if (updated.length !== 1) throw new Error("REVIEW_RELEASE_FAILED");
}

async function releaseReview(transaction: CreatorCompassDatabase, run: WorkerAiRun) {
  const [row] = await transaction.select({ reviewId: aiRuns.reviewId }).from(aiRuns)
    .where(eq(aiRuns.id, run.id)).limit(1);
  if (!row?.reviewId) return;
  await transaction.update(reviews).set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(reviews.id, row.reviewId), eq(reviews.status, "processing")));
}

const databaseDependencies: ReviewProcessorDependencies = {
  generate: executeAiTaskGeneration,
  persistReviewReport,
  releaseReview,
};

export function createReviewAiTaskHandlers(
  dependencies: ReviewProcessorDependencies = databaseDependencies,
): { review_report: AiTaskHandler } {
  return {
    review_report: {
      async process(run, signal) {
        if (run.taskType !== "review_report") throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
        const generated = await dependencies.generate(run.id, signal);
        if (generated.taskType !== "review_report") throw new AiFailure("INVALID_OUTPUT", "AI_GENERATED_TASK_MISMATCH", false);
        const normalized = normalizeReviewReportOutput(generated.output, run.id, run.createdAt ?? new Date());
        return { persist: (transaction) => dependencies.persistReviewReport(transaction, run, normalized) };
      },
      async onTerminalFailure(run) {
        return { persist: (transaction) => dependencies.releaseReview(transaction, run) };
      },
    },
  };
}

export const reviewAiTaskHandlers = createReviewAiTaskHandlers();
