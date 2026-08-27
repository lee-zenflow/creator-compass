"use server";

import { randomUUID } from "node:crypto";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { commitTasks } from "@/features/tasks/task-service";
import { AiFailure } from "@/server/ai/deepseek-client";
import { attachMaterials, confirmContentPlanVersion, createCreationProject, requestContentPlan, retryContentPlan, saveContentPlanVersion } from "./creation-service";
import { contentPlanOutputSchema, creationContentTypeSchema } from "./creation-schemas";
import { getCreationPlanVersion } from "./creation-read-service";

async function actor() {
  try { return await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
}

function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function lines(form: FormData, key: string) { return text(form, key).split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }

export async function createCreationProjectAction(form: FormData) {
  const current = await actor();
  const result = await createCreationProject(current, {
    contentType: creationContentTypeSchema.parse(text(form, "contentType")),
    platform: text(form, "platform"), goal: text(form, "goal"),
    requirements: text(form, "requirements") || null,
    availableMinutes: Number(text(form, "availableMinutes")) || null,
  }).catch(() => null);
  if (!result) redirect("/creation/new?notice=invalid");
  redirect(`/creation/${result.id}/materials`);
}

export async function attachAndGenerateContentPlanAction(form: FormData) {
  const current = await actor();
  const projectId = z.uuid().parse(text(form, "projectId"));
  const materialIds = form.getAll("materialIds").map(String);
  try {
    await attachMaterials(current, projectId, materialIds);
    const result = await requestContentPlan(current, { projectId, idempotencyKey: text(form, "idempotencyKey") || randomUUID() });
    redirect(`/creation/${projectId}/plan?run=${result.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/creation/${projectId}/materials?notice=${error instanceof AiFailure && error.code === "NOT_CONFIGURED" ? "not-configured" : "generation-failed"}`);
  }
}

export async function retryContentPlanAction(form: FormData) {
  const current = await actor();
  const projectId = z.uuid().parse(text(form, "projectId"));
  const failedRunId = z.uuid().parse(text(form, "failedRunId"));
  try {
    const result = await retryContentPlan(current, { projectId, failedRunId });
    redirect(`/creation/${projectId}/plan?run=${result.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/creation/${projectId}/plan?notice=retry-failed`);
  }
}

export async function regenerateContentPlanAction(form: FormData) {
  const current = await actor();
  const projectId = z.uuid().parse(text(form, "projectId"));
  const sourceVersion = z.coerce.number().int().positive().parse(text(form, "sourceVersion"));
  try {
    const result = await requestContentPlan(current, {
      projectId,
      idempotencyKey: `regenerate:${projectId}:${sourceVersion}`,
    });
    redirect(`/creation/${projectId}/plan?run=${result.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/creation/${projectId}/plan?notice=regenerate-failed`);
  }
}

export async function saveContentPlanAction(form: FormData) {
  const current = await actor();
  const reportId = z.uuid().parse(text(form, "reportId"));
  const parentVersion = Number(text(form, "parentVersion"));
  const contentType = creationContentTypeSchema.parse(text(form, "contentType"));
  const common = {
    contentType,
    riskNotes: lines(form, "riskNotes"),
    tasks: JSON.parse(text(form, "tasksJson")),
    citations: JSON.parse(text(form, "citationsJson")),
  };
  const content = contentType === "video" ? {
    ...common, contentType, hooks: lines(form, "hooks"), storyboard: lines(form, "storyboard"),
    voiceover: text(form, "voiceover"), shootingSteps: lines(form, "shootingSteps"),
  } : contentType === "article" ? {
    ...common, contentType, titleSuggestions: lines(form, "titleSuggestions"), outline: lines(form, "outline"),
    body: text(form, "body"), imageSuggestions: lines(form, "imageSuggestions"),
  } : {
    ...common, contentType, titleSuggestions: lines(form, "titleSuggestions"), body: text(form, "body"),
    publishingGuide: lines(form, "publishingGuide"),
  };
  try {
    const parsed = contentPlanOutputSchema.parse(content);
    const result = await saveContentPlanVersion(current, { reportId, parentVersion, content: parsed });
    redirect(`/creation/${text(form, "projectId")}/plan?report=${result.reportId}&version=${result.version}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/creation/${text(form, "projectId")}/plan?report=${reportId}&version=${parentVersion}&edit=1&notice=save-failed`);
  }
}

export async function commitCreationTasksAction(form: FormData) {
  const current = await actor();
  const reportId = z.uuid().parse(text(form, "reportId"));
  const version = Number(text(form, "version"));
  const projectId = z.uuid().parse(text(form, "projectId"));
  try {
    const plan = await getCreationPlanVersion(current, reportId, version);
    const selected = new Set(form.getAll("selectedTaskIds").map(String));
    const allowed = new Set(plan.content.tasks.map((task) => task.id));
    if (!selected.size || [...selected].some((id) => !allowed.has(id))) throw new Error("INVALID_TASK_SELECTION");
    await commitTasks(current, {
      sourceReportId: reportId, sourceVersion: version, idempotencyKey: `creation:${reportId}:${version}`,
      tasks: plan.content.tasks.map((task, order) => ({
        clientId: task.id, title: task.title, reason: task.reason, steps: task.steps,
        plannedDate: task.plannedDate, estimatedMinutes: task.estimatedMinutes,
        completionCriteria: task.completionCriteria, priority: task.priority,
        selected: selected.has(task.id), order,
      })),
    });
    await confirmContentPlanVersion(current, reportId, version);
    redirect("/tasks");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/creation/${projectId}/tasks?report=${reportId}&version=${version}&notice=failed`);
  }
}
