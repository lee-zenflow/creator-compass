import { and, desc, eq } from "drizzle-orm";

import { assertAiInputHashMatches, executeAiTaskGeneration, type AiGeneratedResult } from "@/server/ai/execute-ai-task";
import { AiFailure } from "@/server/ai/deepseek-client";
import { createDatabaseAiRunRepository } from "@/server/ai/run-ai-task";
import type { CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  contentPlans,
  creationProjects,
  creatorProfiles,
  materialReferences,
  reports,
  retrievalRecords,
} from "@/server/db/schema";
import type { AiTaskHandler, WorkerAiRun } from "@/workers/ai-worker";
import {
  assertContentPlanCitationsAllowed,
  normalizeContentPlanOutput,
  type ContentPlanOutput,
} from "./creation-schemas";

export type CreationProcessorDependencies = {
  generate(aiRunId: string, signal: AbortSignal): Promise<AiGeneratedResult>;
  persistContentPlan(transaction: CreatorCompassDatabase, run: WorkerAiRun, output: ContentPlanOutput): Promise<void>;
  releaseCreationProject(transaction: CreatorCompassDatabase, run: WorkerAiRun): Promise<void>;
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

function planSummary(content: ContentPlanOutput) {
  if (content.contentType === "video") return { title: content.hooks[0]!, outline: content.storyboard, body: content.voiceover, media: content.shootingSteps, platform: content.riskNotes };
  if (content.contentType === "article") return { title: content.titleSuggestions[0]!, outline: content.outline, body: content.body, media: content.imageSuggestions, platform: content.riskNotes };
  return { title: content.titleSuggestions[0]!, outline: [], body: content.body, media: content.publishingGuide, platform: content.riskNotes };
}

async function persistContentPlan(transaction: CreatorCompassDatabase, run: WorkerAiRun, output: ContentPlanOutput) {
  const [row] = await transaction.select({
    id: aiRuns.id, userId: aiRuns.userId, guestSessionId: aiRuns.guestSessionId,
    creationProjectId: aiRuns.creationProjectId, taskType: aiRuns.taskType, model: aiRuns.model,
    promptVersionId: aiRuns.promptVersionId, retrievalRecordId: aiRuns.retrievalRecordId,
    inputHash: aiRuns.inputHash,
  }).from(aiRuns).where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "processing"))).limit(1);
  if (!row || row.taskType !== "content_plan" || !row.creationProjectId || !row.retrievalRecordId) {
    throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
  }
  const actor = actorFromRow(row);
  const subject = await createDatabaseAiRunRepository(transaction).findOwnedSubject(actor, "content_plan", row.creationProjectId);
  if (!subject) throw new AiFailure("INVALID_OUTPUT", "AI_RUN_SUBJECT_NOT_FOUND", false);
  assertAiInputHashMatches(row.inputHash, subject.hmacPayload, inputHmacKey());
  const [project] = await transaction.select({ contentType: creationProjects.contentType })
    .from(creationProjects).where(eq(creationProjects.id, row.creationProjectId)).limit(1);
  if (!project || project.contentType !== output.contentType) throw new AiFailure("INVALID_OUTPUT", "CONTENT_TYPE_MISMATCH", false);
  const [retrieval] = await transaction.select({ hits: retrievalRecords.hits }).from(retrievalRecords)
    .where(eq(retrievalRecords.id, row.retrievalRecordId)).limit(1);
  if (!retrieval) throw new AiFailure("INVALID_OUTPUT", "RETRIEVAL_RECORD_MISSING", false);
  try {
    assertContentPlanCitationsAllowed(output, retrieval.hits.filter((hit) => hit.selected).map((hit) => ({ itemId: hit.itemId, sourceId: hit.sourceId })));
  } catch {
    throw new AiFailure("INVALID_OUTPUT", "INVALID_CITATION", false);
  }
  const [latest] = await transaction.select({ reportId: contentPlans.reportId, version: contentPlans.version })
    .from(contentPlans).where(eq(contentPlans.creationProjectId, row.creationProjectId))
    .orderBy(desc(contentPlans.version)).limit(1).for("update");
  let reportId = latest?.reportId;
  const summary = planSummary(output);
  if (!reportId) {
    const [root] = await transaction.insert(reports).values({
      ...ownerValues(row), type: "creation", title: summary.title,
      summary: `${project.contentType} · ${summary.title}`, status: "ready",
    }).returning({ id: reports.id });
    reportId = root?.id;
  }
  if (!reportId) throw new Error("CONTENT_PLAN_ROOT_CREATE_FAILED");
  const [profile] = await transaction.select({ version: creatorProfiles.version }).from(creatorProfiles)
    .where(actor.kind === "user" ? eq(creatorProfiles.userId, actor.userId) : eq(creatorProfiles.guestSessionId, actor.guestSessionId)).limit(1);
  const selected = await transaction.select({ materialId: materialReferences.materialId }).from(materialReferences)
    .where(eq(materialReferences.creationProjectId, row.creationProjectId));
  await transaction.insert(contentPlans).values({
    ...ownerValues(row), reportId, creationProjectId: row.creationProjectId,
    title: summary.title, outline: summary.outline, body: summary.body, contentPayload: output,
    mediaSuggestions: summary.media, platformSuggestions: summary.platform, citations: output.citations,
    sourceSnapshot: { profileVersion: profile?.version ?? null, materialIds: selected.map((item) => item.materialId) },
    model: row.model, promptVersionId: row.promptVersionId, retrievalRecordId: row.retrievalRecordId,
    aiRunId: row.id, generationMode: "ai", version: (latest?.version ?? 0) + 1, status: "ready",
  });
  await transaction.update(reports).set({ title: summary.title, summary: `${project.contentType} · ${summary.title}`, status: "ready", updatedAt: new Date() }).where(eq(reports.id, reportId));
  const updated = await transaction.update(creationProjects).set({ status: "ready", updatedAt: new Date() })
    .where(and(eq(creationProjects.id, row.creationProjectId), eq(creationProjects.status, "processing"))).returning({ id: creationProjects.id });
  if (updated.length !== 1) throw new Error("CREATION_PROJECT_RELEASE_FAILED");
}

async function releaseCreationProject(transaction: CreatorCompassDatabase, run: WorkerAiRun) {
  const [row] = await transaction.select({ creationProjectId: aiRuns.creationProjectId }).from(aiRuns).where(eq(aiRuns.id, run.id)).limit(1);
  if (!row?.creationProjectId) return;
  await transaction.update(creationProjects).set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(creationProjects.id, row.creationProjectId), eq(creationProjects.status, "processing")));
}

const databaseDependencies: CreationProcessorDependencies = {
  generate: executeAiTaskGeneration,
  persistContentPlan,
  releaseCreationProject,
};

export function createCreationAiTaskHandlers(
  dependencies: CreationProcessorDependencies = databaseDependencies,
): { content_plan: AiTaskHandler } {
  return {
    content_plan: {
      async process(run, signal) {
        if (run.taskType !== "content_plan") throw new AiFailure("INVALID_OUTPUT", "AI_RUN_TASK_MISMATCH", false);
        const generated = await dependencies.generate(run.id, signal);
        if (generated.taskType !== "content_plan") throw new AiFailure("INVALID_OUTPUT", "AI_GENERATED_TASK_MISMATCH", false);
        const normalized = normalizeContentPlanOutput(generated.output, run.id, run.createdAt ?? new Date());
        return { persist: (transaction) => dependencies.persistContentPlan(transaction, run, normalized) };
      },
      async onTerminalFailure(run) {
        return { persist: (transaction) => dependencies.releaseCreationProject(transaction, run) };
      },
    },
  };
}

export const creationAiTaskHandlers = createCreationAiTaskHandlers();
