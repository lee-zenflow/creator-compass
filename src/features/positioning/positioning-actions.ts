"use server";

import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logSafeAnalyticsFailure, trackProductEvent } from "@/features/analytics/analytics-service";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { commitTasks } from "@/features/tasks/task-service";
import { db } from "@/server/db/client";
import { creatorProfiles, creatorProfileVersions, positioningSessions } from "@/server/db/schema";
import {
  confirmPositioningCandidate,
  requestPositioningReport,
  retryPositioningRun,
  sendInterviewMessage,
} from "./positioning-service";
import { getConfirmedPositioningCandidate } from "./positioning-read-service";

type ActionFailureCode = "INVALID_INPUT" | "NOT_CONFIGURED" | "PROCESSING" | "FAILED" | "CONFLICT" | "NOT_FOUND" | "INTERVIEW_LIMIT";
type ActionFailure = { ok: false; code: ActionFailureCode; message: string };

function actionFailure(error: unknown): ActionFailure {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "AI_PROCESSING") return { ok: false, code: "PROCESSING", message: "上一项生成仍在处理中，请等待完成。" };
  if (message === "INTERVIEW_LIMIT_REACHED") return { ok: false, code: "INTERVIEW_LIMIT", message: "最多 10 轮核心访谈，可直接生成报告或查看画像。" };
  if (message === "PROFILE_VERSION_CONFLICT" || message === "IDEMPOTENCY_KEY_REUSED") {
    return { ok: false, code: "CONFLICT", message: "内容已在其他页面更新，请刷新后重试。" };
  }
  if (message === "INVALID_TASK_SELECTION") return { ok: false, code: "INVALID_INPUT", message: "选择的任务与已确认方向不一致，请刷新后重试。" };
  if (message === "NOT_FOUND" || message === "REPORT_NOT_READY") return { ok: false, code: "NOT_FOUND", message: "记录不存在或还未生成完成。" };
  if (error instanceof z.ZodError) return { ok: false, code: "INVALID_INPUT", message: "输入内容不完整，请检查后重试。" };
  return { ok: false, code: "FAILED", message: "操作失败，已保留现有内容，请重试。" };
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

const sessionIdSchema = z.uuid();
const sendInputSchema = z.object({ sessionId: z.uuid(), clientMessageId: z.string().trim().min(1).max(128), message: z.string().trim().min(1).max(4_000) }).strict();
const reportIntentSchema = z.object({ sessionId: z.uuid(), idempotencyKey: z.string().trim().min(1).max(128) }).strict();
const retryIntentSchema = z.object({
  sessionId: z.uuid(),
  failedRunId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();
const confirmInputSchema = z.object({
  reportId: z.uuid(), reportVersion: z.number().int().positive(), candidateId: z.string().trim().min(1).max(120), expectedProfileVersion: z.number().int().min(0),
}).strict();
const commitInputSchema = z.object({
  reportId: z.uuid(), reportVersion: z.number().int().positive(), candidateId: z.string().trim().min(1).max(120), selectedTaskIds: z.array(z.string().trim().min(1).max(120)).min(1).max(6),
}).strict();
const profileInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  currentPositioning: z.string().trim().min(1).max(240),
  targetAudience: z.string().trim().min(1).max(2_000),
  contentDirection: z.string().trim().min(1).max(2_000),
}).strict();

export async function createPositioningSessionIntent(
  actor: CurrentActor,
  dependencies: { create: (actor: CurrentActor) => Promise<{ id: string }> } = {
    async create(current) {
      const [row] = await db.insert(positioningSessions).values({ ...ownerValues(current), draft: {}, status: "draft" }).returning({ id: positioningSessions.id });
      if (!row) throw new Error("SESSION_CREATE_FAILED");
      return row;
    },
  },
) {
  try {
    const session = await dependencies.create(actor);
    return { ok: true as const, sessionId: session.id };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function sendInterviewIntent(
  actor: CurrentActor,
  input: z.input<typeof sendInputSchema>,
  dependencies: { send: typeof sendInterviewMessage } = { send: sendInterviewMessage },
) {
  try {
    const parsed = sendInputSchema.parse(input);
    const result = await dependencies.send(actor, parsed);
    if (result.aiStatus === "not_configured") {
      return { ok: false as const, code: "NOT_CONFIGURED" as const, message: "AI 尚未配置，回答已保存。配置后可重试。" };
    }
    if (result.aiStatus === "failed") {
      return { ok: false as const, code: "FAILED" as const, message: "上次处理失败，回答已保存。请使用重试按钮。" };
    }
    return { ok: true as const, code: "PROCESSING" as const, aiRunId: result.aiRunId };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function requestReportIntent(
  actor: CurrentActor,
  input: z.input<typeof reportIntentSchema>,
  dependencies: { request: typeof requestPositioningReport } = { request: requestPositioningReport },
) {
  try {
    const parsed = reportIntentSchema.parse(input);
    const result = await dependencies.request(actor, parsed);
    if (result.aiStatus === "not_configured") {
      return { ok: false as const, code: "NOT_CONFIGURED" as const, message: "AI 尚未配置，暂时无法生成定位报告。" };
    }
    if (result.aiStatus === "failed") {
      return { ok: false as const, code: "FAILED" as const, message: "上次报告生成失败，请使用重试按钮。" };
    }
    return { ok: true as const, code: "PROCESSING" as const, aiRunId: result.aiRunId };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function retryPositioningIntent(
  actor: CurrentActor,
  input: z.input<typeof retryIntentSchema>,
  dependencies: { retry: typeof retryPositioningRun } = { retry: retryPositioningRun },
) {
  try {
    const result = await dependencies.retry(actor, retryIntentSchema.parse(input));
    if (result.aiStatus === "not_configured") {
      return { ok: false as const, code: "NOT_CONFIGURED" as const, message: "AI 尚未配置，现有内容已保留。" };
    }
    return { ok: true as const, code: "PROCESSING" as const, aiRunId: result.aiRunId };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function confirmCandidateIntent(
  actor: CurrentActor,
  input: z.input<typeof confirmInputSchema>,
  dependencies: {
    confirm: typeof confirmPositioningCandidate;
    track?: typeof trackProductEvent;
  } = { confirm: confirmPositioningCandidate },
) {
  try {
    const result = await dependencies.confirm(actor, confirmInputSchema.parse(input));
    await (dependencies.track ?? trackProductEvent)(actor, {
      eventName: "positioning_confirmed",
      flow: "positioning",
      entityVersion: result.reportVersion,
      metadata: {},
    }).catch(logSafeAnalyticsFailure);
    return { ok: true as const, ...result };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function commitPositioningTasksIntent(
  actor: CurrentActor,
  input: z.input<typeof commitInputSchema>,
  dependencies: {
    readConfirmedCandidate: typeof getConfirmedPositioningCandidate;
    commit: (actor: CurrentActor, input: Parameters<typeof commitTasks>[1]) => Promise<Array<{ id: string }>>;
  } = { readConfirmedCandidate: getConfirmedPositioningCandidate, commit: commitTasks },
) {
  try {
    const parsed = commitInputSchema.parse(input);
    const { candidate } = await dependencies.readConfirmedCandidate(actor, parsed.reportId, parsed.reportVersion, parsed.candidateId);
    const selected = new Set(parsed.selectedTaskIds);
    const allowedTaskIds = new Set(candidate.initialTasks.map((task) => task.id));
    if ([...selected].some((taskId) => !allowedTaskIds.has(taskId))) throw new Error("INVALID_TASK_SELECTION");
    const records = await dependencies.commit(actor, {
      sourceReportId: parsed.reportId,
      sourceVersion: parsed.reportVersion,
      idempotencyKey: `positioning:${parsed.reportId}:${parsed.reportVersion}`,
      tasks: candidate.initialTasks.map((task, order) => ({
        clientId: task.id,
        title: task.title,
        reason: task.reason,
        steps: task.steps,
        plannedDate: task.plannedDate,
        estimatedMinutes: task.estimatedMinutes,
        completionCriteria: task.completionCriteria,
        priority: task.priority,
        selected: selected.has(task.id),
        order,
      })),
    });
    return { ok: true as const, count: records.length };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateProfileIntent(
  actor: CurrentActor,
  input: z.input<typeof profileInputSchema>,
  dependencies: { update: (actor: CurrentActor, input: z.output<typeof profileInputSchema>) => Promise<{ profileVersion: number }> } = {
    async update(current, values) {
      return db.transaction(async (transaction) => {
        const [profile] = await transaction.select().from(creatorProfiles)
          .where(actorWhere(current, creatorProfiles)).limit(1).for("update");
        if (!profile) throw new Error("NOT_FOUND");
        if (profile.version !== values.expectedVersion) throw new Error("PROFILE_VERSION_CONFLICT");
        const nextVersion = profile.version + 1;
        const snapshot = {
          profileDimensions: profile.profileDimensions,
          currentPositioning: values.currentPositioning,
          targetAudience: values.targetAudience,
          contentDirection: values.contentDirection,
          platformPreferences: profile.platformPreferences,
          materialNotes: profile.materialNotes,
        };
        await transaction.update(creatorProfiles).set({
          currentPositioning: values.currentPositioning,
          targetAudience: values.targetAudience,
          contentDirection: values.contentDirection,
          version: nextVersion,
          updatedAt: new Date(),
        })
          .where(and(eq(creatorProfiles.id, profile.id), actorWhere(current, creatorProfiles)));
        await transaction.insert(creatorProfileVersions).values({
          ...ownerValues(current), creatorProfileId: profile.id, version: nextVersion, parentVersion: profile.version,
          source: "manual", snapshot,
        });
        return { profileVersion: nextVersion };
      });
    },
  },
) {
  try {
    const result = await dependencies.update(actor, profileInputSchema.parse(input));
    return { ok: true as const, ...result };
  } catch (error) {
    return actionFailure(error);
  }
}

async function currentActor() {
  return resolveCurrentActor(await headers(), await cookies());
}

export async function buildCandidateFailureUrl(input: { sessionId: string; candidateId: string; reportId: string; version: number; notice: string }) {
  return `/positioning/${encodeURIComponent(input.sessionId)}/report/${encodeURIComponent(input.candidateId)}?report=${encodeURIComponent(input.reportId)}&version=${input.version}&notice=${encodeURIComponent(input.notice)}`;
}

export async function buildTaskFailureUrl(input: { sessionId: string; candidateId: string; reportId: string; version: number; notice: string }) {
  return `/positioning/${encodeURIComponent(input.sessionId)}/tasks?report=${encodeURIComponent(input.reportId)}&version=${input.version}&candidate=${encodeURIComponent(input.candidateId)}&notice=${encodeURIComponent(input.notice)}`;
}

export async function createPositioningSessionAction() {
  const result = await createPositioningSessionIntent(await currentActor());
  if (!result.ok) redirect(`/positioning?notice=${result.code.toLowerCase()}`);
  redirect(`/positioning/${result.sessionId}`);
}

export async function sendInterviewAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await sendInterviewIntent(await currentActor(), { sessionId, clientMessageId: String(formData.get("clientMessageId") ?? ""), message: String(formData.get("message") ?? "") });
  revalidatePath(`/positioning/${sessionId}`);
  if (!result.ok) redirect(`/positioning/${sessionId}?notice=${result.code.toLowerCase()}`);
  redirect(`/positioning/${sessionId}?run=${result.aiRunId}`);
}

export async function requestPositioningReportAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await requestReportIntent(await currentActor(), { sessionId, idempotencyKey: String(formData.get("idempotencyKey") ?? "") });
  revalidatePath(`/positioning/${sessionId}`);
  if (!result.ok) redirect(`/positioning/${sessionId}?notice=${result.code.toLowerCase()}`);
  redirect(`/positioning/${sessionId}?run=${result.aiRunId}`);
}

export async function retryPositioningAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await retryPositioningIntent(await currentActor(), {
    sessionId,
    failedRunId: String(formData.get("failedRunId") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  revalidatePath(`/positioning/${sessionId}`);
  if (!result.ok) redirect(`/positioning/${sessionId}?notice=${result.code.toLowerCase()}`);
  redirect(`/positioning/${sessionId}?run=${result.aiRunId}`);
}

export async function confirmCandidateAction(formData: FormData) {
  const sessionId = sessionIdSchema.parse(String(formData.get("sessionId") ?? ""));
  const candidateId = String(formData.get("candidateId") ?? "");
  const result = await confirmCandidateIntent(await currentActor(), {
    reportId: String(formData.get("reportId") ?? ""),
    reportVersion: Number(formData.get("reportVersion")),
    candidateId,
    expectedProfileVersion: Number(formData.get("expectedProfileVersion")),
  });
  if (!result.ok) redirect(await buildCandidateFailureUrl({ sessionId, candidateId, reportId: String(formData.get("reportId") ?? ""), version: Number(formData.get("reportVersion")), notice: result.code.toLowerCase() }));
  revalidatePath("/me/profile");
  redirect(`/positioning/${sessionId}/tasks?report=${result.taskPreviewSource.reportId}&version=${result.taskPreviewSource.reportVersion}&candidate=${result.taskPreviewSource.candidateId}`);
}

export async function commitPositioningTasksAction(formData: FormData) {
  const sessionId = sessionIdSchema.parse(String(formData.get("sessionId") ?? ""));
  const reportId = String(formData.get("reportId") ?? "");
  const reportVersion = Number(formData.get("reportVersion"));
  const candidateId = String(formData.get("candidateId") ?? "");
  const result = await commitPositioningTasksIntent(await currentActor(), {
    reportId,
    reportVersion,
    candidateId,
    selectedTaskIds: formData.getAll("taskId").map(String),
  });
  if (!result.ok) redirect(await buildTaskFailureUrl({ sessionId, reportId, version: reportVersion, candidateId, notice: result.code.toLowerCase() }));
  revalidatePath("/tasks");
  redirect("/tasks");
}

export async function updateProfileAction(formData: FormData) {
  const result = await updateProfileIntent(await currentActor(), {
    expectedVersion: Number(formData.get("expectedVersion")),
    currentPositioning: String(formData.get("currentPositioning") ?? ""),
    targetAudience: String(formData.get("targetAudience") ?? ""),
    contentDirection: String(formData.get("contentDirection") ?? ""),
  });
  if (!result.ok) redirect(`/me/profile?notice=${result.code.toLowerCase()}`);
  revalidatePath("/me/profile");
  redirect("/me/profile?notice=saved");
}
