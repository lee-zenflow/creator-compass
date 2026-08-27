"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logSafeAnalyticsFailure, trackProductEvent } from "@/features/analytics/analytics-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { appendReportVersion } from "@/features/reports/report-service";
import { AiFailure } from "@/server/ai/deepseek-client";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getPrivateStorage } from "@/server/storage/local-storage";
import { getReviewReportVersion, getReviewState } from "./review-read-service";
import { reviewPlatformSchema } from "./review-schemas";
import { createReviewFromConfirmedFields, requestReviewReport, requestReviewTasks, retryReviewReport } from "./review-service";

async function actor() {
  try { return await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
}
function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function optionalMetric(form: FormData, key: string) {
  const value = text(form, key);
  return value === "" ? undefined : Number(value);
}
function publishedAt(value: string) {
  if (!value) return undefined;
  const withOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : value;
  return new Date(withOffset).toISOString();
}

export async function confirmReviewMetricsAction(form: FormData) {
  const current = await actor();
  let created: Awaited<ReturnType<typeof createReviewFromConfirmedFields>> | null = null;
  const privateObjectKey = text(form, "privateObjectKey") || undefined;
  try {
    enforceRateLimit("ocr-confirm", current.kind === "user" ? `user:${current.userId}` : `guest:${current.guestSessionId}`);
    const metrics = {
      views: Number(text(form, "views")),
      likes: optionalMetric(form, "likes"), comments: optionalMetric(form, "comments"),
      favorites: optionalMetric(form, "favorites"), shares: optionalMetric(form, "shares"),
      followersGained: optionalMetric(form, "followersGained"),
    };
    created = await createReviewFromConfirmedFields(current, {
      platform: reviewPlatformSchema.parse(text(form, "platform")),
      platformAccountId: text(form, "platformAccountId") || undefined,
      title: text(form, "title"), publishedAt: publishedAt(text(form, "publishedAt")),
      sourceMode: text(form, "sourceMode") === "ocr" ? "ocr" : "manual", metrics, privateObjectKey,
    });
    const run = await requestReviewReport(current, {
      reviewId: created.reviewId, idempotencyKey: `snapshot:${created.snapshotId}`,
    });
    redirect(`/reviews/${created.reviewId}/report?run=${run.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (created) {
      const notice = error instanceof AiFailure && error.code === "NOT_CONFIGURED" ? "not-configured" : "generation-failed";
      redirect(`/reviews/${created.reviewId}/report?notice=${notice}`);
    }
    if (privateObjectKey) await getPrivateStorage().delete(current, privateObjectKey).catch(() => undefined);
    if (error instanceof Error && error.message === "RATE_LIMITED") redirect("/reviews/new?notice=rate-limited");
    redirect("/reviews/new?notice=invalid");
  }
}

export async function retryReviewReportAction(form: FormData) {
  const current = await actor();
  const reviewId = z.uuid().parse(text(form, "reviewId"));
  const failedRunId = z.uuid().parse(text(form, "failedRunId"));
  try {
    const run = await retryReviewReport(current, { reviewId, failedRunId });
    redirect(`/reviews/${reviewId}/report?run=${run.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/reviews/${reviewId}/report?notice=retry-failed`);
  }
}

export async function generateReviewReportAction(form: FormData) {
  const current = await actor();
  const reviewId = z.uuid().parse(text(form, "reviewId"));
  try {
    const run = await requestReviewReport(current, {
      reviewId,
      idempotencyKey: `confirmed:${reviewId}`,
    });
    redirect(`/reviews/${reviewId}/report?run=${run.aiRunId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/reviews/${reviewId}/report?notice=generation-failed`);
  }
}

export async function saveReviewReportAction(form: FormData) {
  const current = await actor();
  const reportId = z.uuid().parse(text(form, "reportId"));
  const parentVersion = Number(text(form, "parentVersion"));
  const reviewId = z.uuid().parse(text(form, "reviewId"));
  try {
    const parent = await getReviewReportVersion(current, reportId, parentVersion);
    if (parent.citationMode === "legacy") {
      redirect(`/reviews/${reviewId}/report?report=${reportId}&version=${parentVersion}&notice=legacy-edit-disabled`);
    }
    const titles = form.getAll("actionTitle").map(String);
    const reasons = form.getAll("actionReason").map(String);
    const steps = form.getAll("actionSteps").map(String);
    const criteria = form.getAll("actionCriteria").map(String);
    if ([titles, reasons, steps, criteria].some((list) => list.length !== parent.actions.length)) throw new Error("INVALID_ACTIONS");
    const actions = parent.actions.map((action, index) => ({
      ...action,
      title: titles[index]!.trim(), reason: reasons[index]!.trim(),
      steps: steps[index]!.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      completionCriteria: criteria[index]!.trim(),
    }));
    const state = await getReviewState(current, reviewId);
    const saved = await appendReportVersion(current, {
      type: "review",
      root: { reportId, title: `${state.review.contentTitle}复盘`, summary: "已确认数据、计算指标与下一轮行动", status: "ready" },
      version: {
        status: "ready", generation: { mode: "manual", parentVersion }, reviewId,
        dataSummary: parent.dataSummary, keep: parent.retained, problems: parent.problems,
        causes: parent.causes, recommendations: actions, citations: parent.citations,
      },
    });
    await trackProductEvent(current, {
      eventName: "review_actions_saved",
      flow: "review",
      entityVersion: saved.version.version,
      metadata: { itemCount: actions.length },
    }).catch(logSafeAnalyticsFailure);
    redirect(`/reviews/${reviewId}/report?report=${reportId}&version=${saved.version.version}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/reviews/${reviewId}/report?report=${reportId}&version=${parentVersion}&edit=1&notice=save-failed`);
  }
}

export async function commitReviewTasksAction(form: FormData) {
  const current = await actor();
  const reviewId = z.uuid().parse(text(form, "reviewId"));
  const reportId = z.uuid().parse(text(form, "reportId"));
  const version = Number(text(form, "version"));
  try {
    const selected = new Set(form.getAll("selectedTaskIds").map(String));
    await requestReviewTasks(current, { reportId, version, selectedTaskIds: [...selected] });
    redirect("/tasks");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/reviews/${reviewId}/tasks?report=${reportId}&version=${version}&notice=failed`);
  }
}
