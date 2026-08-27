import { and, desc, eq } from "drizzle-orm";

import { AiFailure } from "@/server/ai/deepseek-client";
import {
  assertAiInputHashMatches,
  executeAiTaskGeneration,
  type AiGeneratedResult,
} from "@/server/ai/execute-ai-task";
import {
  createDatabaseAiRunRepository,
} from "@/server/ai/run-ai-task";
import type { CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  interviewMessages,
  positioningReports,
  positioningSessions,
  reports,
  retrievalRecords,
} from "@/server/db/schema";
import type {
  AiTaskHandler,
  AiTaskHandlerMap,
  WorkerAiRun,
} from "@/workers/ai-worker";
import { interviewPolicy, type InterviewPrompt } from "./interview-policy";
import { calculateProfileCompleteness } from "./profile-completeness";
import {
  assertCitationsAllowed,
  normalizePositioningReportOutput,
  type PositioningReportRawOutput,
  type PositioningReportOutput,
  type ProfileExtractOutput,
} from "./positioning-schemas";

type PositioningTaskType = "profile_extract" | "positioning_report";

type PositioningProcessorDependencies = {
  generate(aiRunId: string, signal: AbortSignal): Promise<AiGeneratedResult>;
  persistProfileExtract(
    transaction: CreatorCompassDatabase,
    run: WorkerAiRun,
    output: ProfileExtractOutput,
  ): Promise<void>;
  persistPositioningReport(
    transaction: CreatorCompassDatabase,
    run: WorkerAiRun,
    output: PositioningReportOutput,
  ): Promise<void>;
  releasePositioningSession(
    transaction: CreatorCompassDatabase,
    run: WorkerAiRun,
  ): Promise<void>;
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

async function loadPositioningRun(
  transaction: CreatorCompassDatabase,
  run: WorkerAiRun,
  expectedTaskType: PositioningTaskType,
) {
  const [row] = await transaction
    .select({
      id: aiRuns.id,
      taskType: aiRuns.taskType,
      userId: aiRuns.userId,
      guestSessionId: aiRuns.guestSessionId,
      positioningSessionId: aiRuns.positioningSessionId,
      model: aiRuns.model,
      promptVersionId: aiRuns.promptVersionId,
      retrievalRecordId: aiRuns.retrievalRecordId,
      inputHash: aiRuns.inputHash,
    })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "processing")))
    .limit(1);
  if (!row || row.taskType !== expectedTaskType || !row.positioningSessionId) {
    throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
  }
  const actor = actorFromRow(row);
  const subject = await createDatabaseAiRunRepository(transaction).findOwnedSubject(
    actor,
    expectedTaskType,
    row.positioningSessionId,
  );
  if (!subject) throw new AiFailure("INVALID_OUTPUT", "AI_RUN_SUBJECT_NOT_FOUND", false);
  assertAiInputHashMatches(row.inputHash, subject.hmacPayload, inputHmacKey());
  return row;
}

export function assertProfileEvidenceAllowed(
  output: ProfileExtractOutput,
  allowedUserMessageIds: ReadonlySet<string>,
) {
  for (const dimension of Object.values(output.profileDimensions)) {
    for (const evidenceMessageId of dimension.evidenceMessageIds) {
      if (!allowedUserMessageIds.has(evidenceMessageId)) {
        throw new AiFailure("INVALID_OUTPUT", "INVALID_EVIDENCE_MESSAGE", false);
      }
    }
  }
}

export function nextInterviewQuestion(
  currentStep: number,
  completeness: number,
  nextQuestion: string | null,
) {
  return currentStep < 10 && completeness < 100 ? nextQuestion : null;
}

export function milestonePromptText(prompt: InterviewPrompt | null) {
  if (prompt === "complete") return "画像信息已完整，可以生成定位报告。";
  if (prompt === "eighty") return "画像完整度已达到 80%，可以生成定位报告，也可以继续补充。";
  return null;
}

export function normalizePositioningReportIds(
  output: PositioningReportRawOutput,
  allowedHits: Array<{ itemId: string; sourceId: string }>,
  aiRunId: string,
): PositioningReportOutput {
  const normalized = normalizePositioningReportOutput(output, aiRunId);
  assertAllowedCitationPairs(normalized, allowedHits);
  return normalized;
}

function assertAllowedCitationPairs(
  output: PositioningReportOutput,
  allowedHits: Array<{ itemId: string; sourceId: string }>,
) {
  try {
    assertCitationsAllowed(output, allowedHits);
  } catch {
    throw new AiFailure("INVALID_OUTPUT", "INVALID_CITATION", false);
  }
}

async function persistProfileExtract(
  transaction: CreatorCompassDatabase,
  run: WorkerAiRun,
  output: ProfileExtractOutput,
) {
  const row = await loadPositioningRun(transaction, run, "profile_extract");
  const userMessages = await transaction
    .select({ id: interviewMessages.id })
    .from(interviewMessages)
    .where(and(
      eq(interviewMessages.positioningSessionId, row.positioningSessionId!),
      eq(interviewMessages.sender, "user"),
    ));
  assertProfileEvidenceAllowed(output, new Set(userMessages.map((message) => message.id)));
  const completeness = calculateProfileCompleteness(output.profileDimensions);
  const [session] = await transaction
    .select({ draft: positioningSessions.draft, currentStep: positioningSessions.currentStep })
    .from(positioningSessions)
    .where(eq(positioningSessions.id, row.positioningSessionId!))
    .limit(1);
  if (!session) throw new Error("POSITIONING_SESSION_NOT_FOUND");
  const priorPrompts = Array.isArray(session.draft.milestonePrompts)
    ? session.draft.milestonePrompts.filter(
        (prompt): prompt is InterviewPrompt => prompt === "eighty" || prompt === "complete",
      )
    : [];
  const milestone = interviewPolicy({
    coreQuestionCount: session.currentStep,
    priorPrompts,
    completeness: completeness.percentage,
  }).prompt;
  const question = milestonePromptText(milestone) ?? nextInterviewQuestion(
    session.currentStep,
    completeness.percentage,
    output.nextQuestion,
  );
  if (question) {
    await transaction.insert(interviewMessages).values({
      positioningSessionId: row.positioningSessionId!,
      sender: "assistant",
      content: question,
      extractedProfile: output.profileDimensions,
    });
  }
  const updated = await transaction
    .update(positioningSessions)
    .set({
      draft: {
        ...session.draft,
        profileDimensions: output.profileDimensions,
        milestonePrompts: milestone ? [...priorPrompts, milestone] : priorPrompts,
      },
      completeness: completeness.percentage,
      status: "draft",
      updatedAt: new Date(),
    })
    .where(and(
      eq(positioningSessions.id, row.positioningSessionId!),
      eq(positioningSessions.status, "processing"),
    ))
    .returning({ id: positioningSessions.id });
  if (updated.length !== 1) throw new Error("POSITIONING_SESSION_RELEASE_FAILED");
}

async function persistPositioningReport(
  transaction: CreatorCompassDatabase,
  run: WorkerAiRun,
  output: PositioningReportOutput,
) {
  const row = await loadPositioningRun(transaction, run, "positioning_report");
  if (!row.retrievalRecordId) throw new AiFailure("INVALID_OUTPUT", "RETRIEVAL_RECORD_MISSING", false);
  const [retrieval] = await transaction
    .select({ hits: retrievalRecords.hits })
    .from(retrievalRecords)
    .where(eq(retrievalRecords.id, row.retrievalRecordId))
    .limit(1);
  if (!retrieval) throw new AiFailure("INVALID_OUTPUT", "RETRIEVAL_RECORD_MISSING", false);
  const allowedHits = retrieval.hits
      .filter((hit) => hit.selected)
      .map((hit) => ({ itemId: hit.itemId, sourceId: hit.sourceId }));
  assertAllowedCitationPairs(output, allowedHits);
  const candidates = output.candidates;
  const [latest] = await transaction
    .select({ reportId: positioningReports.reportId, version: positioningReports.version })
    .from(positioningReports)
    .where(eq(positioningReports.positioningSessionId, row.positioningSessionId!))
    .orderBy(desc(positioningReports.version))
    .limit(1)
    .for("update");
  let reportId = latest?.reportId;
  if (!reportId) {
    const [root] = await transaction
      .insert(reports)
      .values({
        ...ownerValues(row),
        type: "positioning",
        title: "IP 定位报告",
        summary: candidates.map((candidate) => candidate.name).join("、"),
        status: "ready",
      })
      .returning({ id: reports.id });
    reportId = root?.id;
  }
  if (!reportId) throw new Error("POSITIONING_REPORT_ROOT_CREATE_FAILED");
  await transaction.insert(positioningReports).values({
    ...ownerValues(row),
    reportId,
    positioningSessionId: row.positioningSessionId!,
    candidates,
    evidence: candidates.flatMap((candidate) => candidate.citations),
    model: row.model,
    promptVersionId: row.promptVersionId,
    retrievalRecordId: row.retrievalRecordId,
    aiRunId: row.id,
    generationMode: "ai",
    version: (latest?.version ?? 0) + 1,
    status: "ready",
  });
  await transaction
    .update(reports)
    .set({
      summary: candidates.map((candidate) => candidate.name).join("、"),
      status: "ready",
      updatedAt: new Date(),
    })
    .where(eq(reports.id, reportId));
  const updated = await transaction
    .update(positioningSessions)
    .set({ status: "ready", updatedAt: new Date() })
    .where(and(
      eq(positioningSessions.id, row.positioningSessionId!),
      eq(positioningSessions.status, "processing"),
    ))
    .returning({ id: positioningSessions.id });
  if (updated.length !== 1) throw new Error("POSITIONING_SESSION_RELEASE_FAILED");
}

async function releasePositioningSession(
  transaction: CreatorCompassDatabase,
  run: WorkerAiRun,
) {
  const [row] = await transaction
    .select({ positioningSessionId: aiRuns.positioningSessionId })
    .from(aiRuns)
    .where(eq(aiRuns.id, run.id))
    .limit(1);
  if (!row?.positioningSessionId) return;
  await transaction
    .update(positioningSessions)
    .set({ status: "draft", updatedAt: new Date() })
    .where(and(
      eq(positioningSessions.id, row.positioningSessionId),
      eq(positioningSessions.status, "processing"),
    ));
}

const databaseDependencies: PositioningProcessorDependencies = {
  generate: executeAiTaskGeneration,
  persistProfileExtract,
  persistPositioningReport,
  releasePositioningSession,
};

export function createPositioningAiTaskHandlers(
  dependencies: PositioningProcessorDependencies = databaseDependencies,
): Pick<AiTaskHandlerMap, PositioningTaskType> {
  const handler = (taskType: PositioningTaskType): AiTaskHandler => ({
    async process(run, signal) {
      if (run.taskType !== taskType) {
        throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
      }
      const generated = await dependencies.generate(run.id, signal);
      if (generated.taskType !== taskType) {
        throw new AiFailure("INVALID_OUTPUT", "AI_GENERATED_TASK_MISMATCH", false);
      }
      return {
        async persist(transaction) {
          if (generated.taskType === "profile_extract") {
            await dependencies.persistProfileExtract(transaction, run, generated.output);
          } else if (generated.taskType === "positioning_report") {
            const normalized = normalizePositioningReportOutput(
              generated.output,
              run.id,
              run.createdAt ?? new Date(),
            );
            await dependencies.persistPositioningReport(transaction, run, normalized);
          } else {
            throw new AiFailure("INVALID_OUTPUT", "AI_GENERATED_TASK_MISMATCH", false);
          }
        },
      };
    },
    async onTerminalFailure(run) {
      return {
        persist: (transaction) => dependencies.releasePositioningSession(transaction, run),
      };
    },
  });
  return {
    profile_extract: handler("profile_extract"),
    positioning_report: handler("positioning_report"),
  };
}

export const positioningAiTaskHandlers = createPositioningAiTaskHandlers();
