import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { enqueueAiRun } from "@/server/ai/run-ai-task";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  contentPlans,
  creationProjects,
  materialReferences,
  materials,
} from "@/server/db/schema";
import {
  contentPlanOutputSchema,
  creationRequestSchema,
  type ContentPlanOutput,
  type CreationContentType,
  type CreationRequest,
} from "./creation-schemas";

type RecordStatus = "draft" | "processing" | "ready" | "failed" | "archived";
type ProjectRecord = { id: string; status: RecordStatus; contentType: CreationContentType };
export type PlanVersionRecord = {
  reportId: string;
  version: number;
  status: RecordStatus;
  generationMode: "ai" | "manual";
  contentType: CreationContentType;
  content: ContentPlanOutput;
};

export interface CreationRepository {
  transaction<T>(work: (repository: CreationRepository) => Promise<T>): Promise<T>;
  createProject(actor: CurrentActor, input: z.output<typeof creationRequestSchema>): Promise<{ id: string }>;
  findProject(actor: CurrentActor, projectId: string): Promise<ProjectRecord | null>;
  replaceMaterials(actor: CurrentActor, projectId: string, materialIds: string[]): Promise<void>;
  setProjectStatus(actor: CurrentActor, projectId: string, status: RecordStatus): Promise<void>;
  findRunByKey(actor: CurrentActor, projectId: string, idempotencyKey: string): Promise<{ id: string; status: RecordStatus } | null>;
  findRun(actor: CurrentActor, projectId: string, runId: string): Promise<{ id: string; status: RecordStatus } | null>;
  findActiveRun(actor: CurrentActor, projectId: string): Promise<{ id: string } | null>;
  findPlanVersion(actor: CurrentActor, reportId: string, version: number): Promise<PlanVersionRecord | null>;
  appendManualVersion(actor: CurrentActor, input: { parent: PlanVersionRecord; content: ContentPlanOutput }): Promise<{ reportId: string; version: number }>;
  markConfirmed(actor: CurrentActor, reportId: string, version: number): Promise<void>;
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

function planSummary(content: ContentPlanOutput) {
  if (content.contentType === "video") return { title: content.hooks[0]!, outline: content.storyboard, body: content.voiceover, media: content.shootingSteps, platform: content.riskNotes };
  if (content.contentType === "article") return { title: content.titleSuggestions[0]!, outline: content.outline, body: content.body, media: content.imageSuggestions, platform: content.riskNotes };
  return { title: content.titleSuggestions[0]!, outline: [], body: content.body, media: content.publishingGuide, platform: content.riskNotes };
}

function createDatabaseCreationRepository(database: CreatorCompassDatabase): CreationRepository {
  return {
    transaction(work) {
      return database.transaction((tx) => work(createDatabaseCreationRepository(tx as unknown as CreatorCompassDatabase)));
    },
    async createProject(actor, input) {
      const [row] = await database.insert(creationProjects).values({ ...ownerValues(actor), ...input, requirements: input.requirements ?? null, availableMinutes: input.availableMinutes ?? null }).returning({ id: creationProjects.id });
      if (!row) throw new Error("PROJECT_CREATE_FAILED");
      return row;
    },
    async findProject(actor, projectId) {
      const [row] = await database.select({ id: creationProjects.id, status: creationProjects.status, contentType: creationProjects.contentType })
        .from(creationProjects).where(and(eq(creationProjects.id, projectId), actorWhere(actor, creationProjects))).limit(1).for("update");
      if (!row) return null;
      return { ...row, contentType: z.enum(["article", "video", "copy"]).parse(row.contentType) };
    },
    async replaceMaterials(actor, projectId, materialIds) {
      const uniqueIds = [...new Set(materialIds)];
      if (uniqueIds.length) {
        const owned = await database.select({ id: materials.id }).from(materials)
          .where(and(inArray(materials.id, uniqueIds), actorWhere(actor, materials)));
        if (owned.length !== uniqueIds.length) throw new Error("MATERIAL_NOT_FOUND");
      }
      await database.delete(materialReferences).where(and(eq(materialReferences.creationProjectId, projectId), actorWhere(actor, materialReferences)));
      if (uniqueIds.length) await database.insert(materialReferences).values(uniqueIds.map((materialId) => ({ ...ownerValues(actor), creationProjectId: projectId, materialId })));
    },
    async setProjectStatus(actor, projectId, status) {
      const rows = await database.update(creationProjects).set({ status, updatedAt: new Date() })
        .where(and(eq(creationProjects.id, projectId), actorWhere(actor, creationProjects))).returning({ id: creationProjects.id });
      if (rows.length !== 1) throw new Error("PROJECT_NOT_FOUND");
    },
    async findRunByKey(actor, projectId, idempotencyKey) {
      const [row] = await database.select({ id: aiRuns.id, status: aiRuns.status }).from(aiRuns)
        .where(and(eq(aiRuns.creationProjectId, projectId), eq(aiRuns.taskType, "content_plan"), eq(aiRuns.idempotencyKey, idempotencyKey), actorWhere(actor, aiRuns))).limit(1);
      return row ?? null;
    },
    async findRun(actor, projectId, runId) {
      const [row] = await database.select({ id: aiRuns.id, status: aiRuns.status }).from(aiRuns)
        .where(and(
          eq(aiRuns.id, runId), eq(aiRuns.creationProjectId, projectId),
          eq(aiRuns.taskType, "content_plan"), actorWhere(actor, aiRuns),
        )).limit(1);
      return row ?? null;
    },
    async findActiveRun(actor, projectId) {
      const [row] = await database.select({ id: aiRuns.id }).from(aiRuns)
        .where(and(eq(aiRuns.creationProjectId, projectId), eq(aiRuns.taskType, "content_plan"), eq(aiRuns.status, "processing"), actorWhere(actor, aiRuns))).limit(1);
      return row ?? null;
    },
    async findPlanVersion(actor, reportId, version) {
      const [row] = await database.select({ plan: contentPlans, contentType: creationProjects.contentType })
        .from(contentPlans).innerJoin(creationProjects, eq(contentPlans.creationProjectId, creationProjects.id))
        .where(and(eq(contentPlans.reportId, reportId), eq(contentPlans.version, version), actorWhere(actor, contentPlans))).limit(1).for("update");
      if (!row) return null;
      return {
        reportId: row.plan.reportId, version: row.plan.version, status: row.plan.status,
        generationMode: row.plan.generationMode,
        contentType: z.enum(["article", "video", "copy"]).parse(row.contentType),
        content: contentPlanOutputSchema.parse(row.plan.contentPayload),
      };
    },
    async appendManualVersion(actor, input) {
      const [latest] = await database.select({ plan: contentPlans, contentType: creationProjects.contentType })
        .from(contentPlans).innerJoin(creationProjects, eq(contentPlans.creationProjectId, creationProjects.id))
        .where(and(eq(contentPlans.reportId, input.parent.reportId), actorWhere(actor, contentPlans)))
        .orderBy(desc(contentPlans.version)).limit(1).for("update");
      if (!latest || latest.plan.version !== input.parent.version) throw new Error("PLAN_VERSION_CONFLICT");
      const summary = planSummary(input.content);
      const [row] = await database.insert(contentPlans).values({
        ...ownerValues(actor), reportId: latest.plan.reportId, creationProjectId: latest.plan.creationProjectId,
        title: summary.title, outline: summary.outline, body: summary.body, contentPayload: input.content,
        mediaSuggestions: summary.media, platformSuggestions: summary.platform,
        citations: input.content.citations, sourceSnapshot: latest.plan.sourceSnapshot,
        generationMode: "manual", parentVersion: latest.plan.version, version: latest.plan.version + 1,
        status: "ready",
      }).returning({ reportId: contentPlans.reportId, version: contentPlans.version });
      if (!row) throw new Error("PLAN_VERSION_CREATE_FAILED");
      return row;
    },
    async markConfirmed(actor, reportId, version) {
      const rows = await database.update(contentPlans).set({ confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contentPlans.reportId, reportId), eq(contentPlans.version, version), actorWhere(actor, contentPlans), isNull(contentPlans.confirmedAt)))
        .returning({ id: contentPlans.id });
      if (rows.length > 1) throw new Error("PLAN_CONFIRM_FAILED");
    },
  };
}

export const databaseCreationRepository = createDatabaseCreationRepository(db);

export async function createCreationProject(actor: CurrentActor, input: CreationRequest, repository = databaseCreationRepository) {
  return repository.createProject(actor, creationRequestSchema.parse(input));
}

export async function attachMaterials(actor: CurrentActor, projectId: string, materialIds: string[], repository = databaseCreationRepository) {
  const id = z.uuid().parse(projectId);
  const ids = z.array(z.uuid()).max(20).parse(materialIds);
  return repository.transaction(async (tx) => {
    const project = await tx.findProject(actor, id);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.status !== "draft" && project.status !== "failed") throw new Error("PROJECT_NOT_EDITABLE");
    await tx.replaceMaterials(actor, id, ids);
  });
}

export async function requestContentPlan(
  actor: CurrentActor,
  input: { projectId: string; idempotencyKey: string },
  dependencies: { repository: CreationRepository; enqueue: typeof enqueueAiRun } = { repository: databaseCreationRepository, enqueue: enqueueAiRun },
) {
  const parsed = z.object({ projectId: z.uuid(), idempotencyKey: z.string().trim().min(1).max(128) }).strict().parse(input);
  const prior = await dependencies.repository.findRunByKey(actor, parsed.projectId, parsed.idempotencyKey);
  if (prior) return { aiRunId: prior.id, aiStatus: prior.status };
  const project = await dependencies.repository.findProject(actor, parsed.projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const active = await dependencies.repository.findActiveRun(actor, parsed.projectId);
  if (active) throw new Error("AI_PROCESSING");
  await dependencies.repository.setProjectStatus(actor, parsed.projectId, "processing");
  try {
    const run = await dependencies.enqueue(actor, { taskType: "content_plan", entityId: parsed.projectId, idempotencyKey: parsed.idempotencyKey });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    const otherActive = await dependencies.repository.findActiveRun(actor, parsed.projectId).catch(() => ({ id: "unknown" }));
    if (!otherActive) await dependencies.repository.setProjectStatus(actor, parsed.projectId, "draft");
    throw error;
  }
}

export async function retryContentPlan(
  actor: CurrentActor,
  input: { projectId: string; failedRunId: string },
  dependencies: { repository: CreationRepository; enqueue: typeof enqueueAiRun } = {
    repository: databaseCreationRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = z.object({ projectId: z.uuid(), failedRunId: z.uuid() }).strict().parse(input);
  const idempotencyKey = `retry:${parsed.failedRunId}`;
  const prior = await dependencies.repository.findRunByKey(actor, parsed.projectId, idempotencyKey);
  if (prior) return { aiRunId: prior.id, aiStatus: prior.status };

  await dependencies.repository.transaction(async (repository) => {
    const project = await repository.findProject(actor, parsed.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const failedRun = await repository.findRun(actor, parsed.projectId, parsed.failedRunId);
    if (!failedRun || failedRun.status !== "failed") throw new Error("AI_RUN_NOT_RETRYABLE");
    if (await repository.findActiveRun(actor, parsed.projectId)) throw new Error("AI_PROCESSING");
    await repository.setProjectStatus(actor, parsed.projectId, "processing");
  });

  try {
    const run = await dependencies.enqueue(actor, {
      taskType: "content_plan",
      entityId: parsed.projectId,
      idempotencyKey,
    });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    const active = await dependencies.repository.findActiveRun(actor, parsed.projectId)
      .catch(() => ({ id: "unknown" }));
    if (!active) await dependencies.repository.setProjectStatus(actor, parsed.projectId, "failed");
    throw error;
  }
}

export async function saveContentPlanVersion(
  actor: CurrentActor,
  input: { reportId: string; parentVersion: number; content: unknown },
  repository = databaseCreationRepository,
) {
  const parsed = z.object({ reportId: z.uuid(), parentVersion: z.number().int().positive(), content: contentPlanOutputSchema }).strict().parse(input);
  return repository.transaction(async (tx) => {
    const parent = await tx.findPlanVersion(actor, parsed.reportId, parsed.parentVersion);
    if (!parent || parent.status !== "ready") throw new Error("PLAN_NOT_FOUND");
    if (parent.contentType !== parsed.content.contentType) throw new Error("CONTENT_TYPE_MISMATCH");
    return tx.appendManualVersion(actor, { parent, content: parsed.content });
  });
}

export async function confirmContentPlanVersion(
  actor: CurrentActor,
  reportId: string,
  version: number,
  repository = databaseCreationRepository,
) {
  const parsed = z.object({ reportId: z.uuid(), version: z.number().int().positive() }).parse({ reportId, version });
  const plan = await repository.findPlanVersion(actor, parsed.reportId, parsed.version);
  if (!plan || plan.status !== "ready") throw new Error("PLAN_NOT_FOUND");
  await repository.markConfirmed(actor, parsed.reportId, parsed.version);
}
