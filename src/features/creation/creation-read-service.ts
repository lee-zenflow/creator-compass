import { and, desc, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import { aiRuns, contentPlans, creationProjects, materialReferences } from "@/server/db/schema";
import { contentPlanOutputSchema, creationContentTypeSchema, type ContentPlanOutput } from "./creation-schemas";

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

export type CreationProjectView = {
  id: string;
  contentType: "article" | "video" | "copy";
  platform: string;
  goal: string;
  requirements: string | null;
  availableMinutes: number | null;
  status: "draft" | "processing" | "ready" | "failed" | "archived";
  selectedMaterialIds: string[];
};

export type CreationPlanView = {
  id: string;
  reportId: string;
  projectId: string;
  version: number;
  generationMode: "ai" | "manual";
  status: "draft" | "processing" | "ready" | "failed" | "archived";
  content: ContentPlanOutput;
  sourceSnapshot: { profileVersion: number | null; materialIds: string[] };
  retrievalRecordId: string | null;
};

function toPlan(row: typeof contentPlans.$inferSelect): CreationPlanView {
  return {
    id: row.id,
    reportId: row.reportId,
    projectId: row.creationProjectId,
    version: row.version,
    generationMode: row.generationMode,
    status: row.status,
    content: contentPlanOutputSchema.parse(row.contentPayload),
    sourceSnapshot: row.sourceSnapshot,
    retrievalRecordId: row.retrievalRecordId,
  };
}

export async function getCreationProject(actor: CurrentActor, projectId: string): Promise<CreationProjectView> {
  const id = z.uuid().parse(projectId);
  const [row] = await db.select().from(creationProjects)
    .where(and(eq(creationProjects.id, id), actorWhere(actor, creationProjects))).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  const references = await db.select({ materialId: materialReferences.materialId }).from(materialReferences)
    .where(and(eq(materialReferences.creationProjectId, id), actorWhere(actor, materialReferences)));
  return {
    id: row.id, contentType: creationContentTypeSchema.parse(row.contentType), platform: row.platform,
    goal: row.goal, requirements: row.requirements, availableMinutes: row.availableMinutes,
    status: row.status, selectedMaterialIds: references.map((item) => item.materialId),
  };
}

export async function getCreationPlanState(actor: CurrentActor, projectId: string) {
  const project = await getCreationProject(actor, projectId);
  const plans = await db.select().from(contentPlans)
    .where(and(eq(contentPlans.creationProjectId, project.id), actorWhere(actor, contentPlans)))
    .orderBy(desc(contentPlans.version));
  const [run] = await db.select({
    id: aiRuns.id,
    status: aiRuns.status,
    errorCode: aiRuns.errorCode,
    safeErrorDetail: aiRuns.safeErrorDetail,
  })
    .from(aiRuns).where(and(eq(aiRuns.creationProjectId, project.id), eq(aiRuns.taskType, "content_plan"), actorWhere(actor, aiRuns)))
    .orderBy(desc(aiRuns.createdAt)).limit(1);
  return { project, plans: plans.map(toPlan), latestPlan: plans[0] ? toPlan(plans[0]) : null, latestRun: run ?? null };
}

export async function getCreationPlanVersion(actor: CurrentActor, reportId: string, version: number) {
  const parsed = z.object({ reportId: z.uuid(), version: z.number().int().positive() }).parse({ reportId, version });
  const [row] = await db.select().from(contentPlans)
    .where(and(eq(contentPlans.reportId, parsed.reportId), eq(contentPlans.version, parsed.version), actorWhere(actor, contentPlans))).limit(1);
  if (!row) throw new Error("NOT_FOUND");
  return toPlan(row);
}
