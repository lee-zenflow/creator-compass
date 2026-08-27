"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { logSafeAnalyticsFailure, trackProductEvent } from "@/features/analytics/analytics-service";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { batchTaskStatusSchema, moveTaskSchema, taskIdSchema } from "./task-schemas";
import { batchUpdateTaskStatus, deleteTask, moveTask, startTask, updateTask, type TaskRecord } from "./task-service";

type TaskNotice = "invalid" | "conflict" | "failed" | "started" | "completed" | "restored" | "moved";
type TaskContext = { range: "today" | "week" | "all"; status: "pending" | "in_progress" | "completed" | "dismissed" | "all" };

function contextFrom(formData: FormData): TaskContext {
  const requestedRange = String(formData.get("range") ?? "all");
  const requestedStatus = String(formData.get("status") ?? "all");
  return {
    range: requestedRange === "today" || requestedRange === "week" ? requestedRange : "all",
    status: ["pending", "in_progress", "completed", "dismissed"].includes(requestedStatus) ? requestedStatus as TaskContext["status"] : "all",
  };
}

function taskListUrl(context: TaskContext, notice: TaskNotice) {
  const query = new URLSearchParams({ range: context.range });
  if (context.status !== "all") query.set("status", context.status);
  query.set("notice", notice);
  return `/tasks?${query.toString()}`;
}

function noticeFor(error: unknown): TaskNotice {
  return error instanceof Error && error.message === "INVALID_TASK_TRANSITION" ? "conflict" : "failed";
}

function finish(context: TaskContext, ids: string[], notice: TaskNotice): never {
  revalidatePath("/tasks");
  for (const id of new Set(ids)) revalidatePath(`/tasks/${id}`);
  redirect(taskListUrl(context, notice));
}

function rejectInvalid(context: TaskContext): never {
  redirect(taskListUrl(context, "invalid"));
}

async function actorFromSession(): Promise<CurrentActor> {
  return resolveCurrentActor(await headers(), await cookies());
}

async function trackCompletions(actor: CurrentActor, changed: TaskRecord[]) {
  await Promise.all(changed.map((task) => trackProductEvent(actor, {
    eventName: "task_completed",
    flow: "task",
    entityVersion: task.sourceVersion,
    metadata: {},
  }).catch(logSafeAnalyticsFailure)));
}

export async function startTaskAction(formData: FormData) {
  const context = contextFrom(formData);
  const parsed = taskIdSchema.safeParse(String(formData.get("taskId") ?? ""));
  if (!parsed.success) return rejectInvalid(context);
  const actor = await actorFromSession();
  try {
    await startTask(actor, parsed.data);
  } catch (error) {
    return finish(context, [], noticeFor(error));
  }
  return finish(context, [parsed.data], "started");
}

export async function completeTaskAction(formData: FormData) {
  const context = contextFrom(formData);
  const parsed = taskIdSchema.safeParse(String(formData.get("taskId") ?? ""));
  if (!parsed.success) return rejectInvalid(context);
  const actor = await actorFromSession();
  try {
    const result = await batchUpdateTaskStatus(actor, { taskIds: [parsed.data], targetStatus: "completed" });
    if (result.changed.length > 0) await trackCompletions(actor, result.changed);
  } catch (error) {
    return finish(context, [], noticeFor(error));
  }
  return finish(context, [parsed.data], "completed");
}

export async function restoreTaskAction(formData: FormData) {
  const context = contextFrom(formData);
  const parsed = taskIdSchema.safeParse(String(formData.get("taskId") ?? ""));
  if (!parsed.success) return rejectInvalid(context);
  const actor = await actorFromSession();
  try {
    await batchUpdateTaskStatus(actor, { taskIds: [parsed.data], targetStatus: "pending" });
  } catch (error) {
    return finish(context, [], noticeFor(error));
  }
  return finish(context, [parsed.data], "restored");
}

export async function batchTaskStatusAction(formData: FormData) {
  const context = contextFrom(formData);
  const parsed = batchTaskStatusSchema.safeParse({
    taskIds: formData.getAll("taskIds").map(String),
    targetStatus: String(formData.get("targetStatus") ?? ""),
  });
  if (!parsed.success) return rejectInvalid(context);
  const actor = await actorFromSession();
  try {
    const result = await batchUpdateTaskStatus(actor, parsed.data);
    if (parsed.data.targetStatus === "completed" && result.changed.length > 0) {
      await trackCompletions(actor, result.changed);
    }
  } catch (error) {
    return finish(context, [], noticeFor(error));
  }
  return finish(context, parsed.data.taskIds, parsed.data.targetStatus === "completed" ? "completed" : "restored");
}

export async function moveTaskAction(formData: FormData) {
  const context = contextFrom(formData);
  const parsed = moveTaskSchema.safeParse({
    taskId: String(formData.get("taskId") ?? ""),
    direction: String(formData.get("direction") ?? ""),
  });
  if (!parsed.success) return rejectInvalid(context);
  const actor = await actorFromSession();
  try {
    await moveTask(actor, parsed.data);
  } catch (error) {
    return finish(context, [], noticeFor(error));
  }
  return finish(context, [parsed.data.taskId], "moved");
}

export async function deleteTaskAction(formData: FormData) {
  const actor = await actorFromSession();
  await deleteTask(actor, String(formData.get("taskId") ?? ""));
  revalidatePath("/tasks");
  redirect("/tasks");
}

export async function updateTaskAction(formData: FormData) {
  const actor = await actorFromSession();
  const taskId = String(formData.get("taskId") ?? "");
  await updateTask(actor, taskId, {
    title: String(formData.get("title") ?? ""), reason: String(formData.get("reason") ?? ""),
    steps: String(formData.get("steps") ?? "").split("\n").map((step) => step.trim()).filter(Boolean),
    plannedDate: String(formData.get("plannedDate") ?? ""), estimatedMinutes: Number(formData.get("estimatedMinutes")),
    completionCriteria: String(formData.get("completionCriteria") ?? ""), priority: Number(formData.get("priority")) as 1 | 2 | 3,
  });
  revalidatePath("/tasks"); revalidatePath(`/tasks/${taskId}`); redirect(`/tasks/${taskId}`);
}
