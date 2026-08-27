import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { AiSendDisclosure } from "@/components/ui/ai-send-disclosure";
import { resolveRunCitations } from "@/features/citations/citation-service";
import { RecoveryAction } from "@/components/ui/recovery-action";
import { StatusRow } from "@/components/ui/status-row";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { buildFallbackSendDisclosure, buildSendDisclosure } from "@/features/ai/send-disclosure";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { AiRunWatcher } from "@/features/positioning/ai-run-watcher";
import { generateReviewReportAction, retryReviewReportAction, saveReviewReportAction } from "@/features/reviews/review-actions";
import { getLegacyReviewSources, getReviewReportVersion, getReviewState } from "@/features/reviews/review-read-service";
import { ReviewReportView } from "@/features/reviews/review-ui";

export default async function ReviewReportPage({ params, searchParams }: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<{ report?: string; version?: string; edit?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { reviewId } = await params;
  const query = await searchParams;
  const state = await getReviewState(actor, reviewId).catch(() => null);
  if (!state) notFound();
  const requested = query.report && Number.isInteger(Number(query.version))
    ? await getReviewReportVersion(actor, query.report, Number(query.version)).catch(() => null)
    : null;
  const report = requested ?? state.latestReport;
  const citations = report?.citationMode === "exact" && report.citationRetrievalRecordId
    ? await resolveRunCitations(actor, report.citationRetrievalRecordId, report.citations).catch(() => [])
    : [];
  const legacySources = report?.citationMode === "legacy"
    ? await getLegacyReviewSources(report.legacySourceIds).catch(() => [])
    : [];
  const editing = query.edit === "1" && Boolean(report) && report?.citationMode !== "legacy";
  const disclosure = await buildSendDisclosure(actor, "review_report", reviewId)
    .catch(() => buildFallbackSendDisclosure("review_report"));
  const footer = report ? editing
    ? <><Link className="compact-button" data-variant="secondary" href={`/reviews/${reviewId}/report?report=${report.reportId}&version=${report.version}`}>取消</Link><button className="compact-button" form="review-report-editor" type="submit">保存新版本</button></>
    : <>{report.citationMode !== "legacy" ? <Link className="compact-button" data-variant="secondary" href={`/reviews/${reviewId}/report?report=${report.reportId}&version=${report.version}&edit=1`}>编辑行动</Link> : null}<Link className="compact-button" href={`/reviews/${reviewId}/tasks?report=${report.reportId}&version=${report.version}`}>预览任务</Link></>
    : undefined;

  return <AppShell title="复盘报告" backHref="/reviews/new" bottomNav={false} stickyFooter={footer}>
    <div className="flow-content compact-page">
      {!report && state.latestRun?.status === "processing" ? <>
        <StatusRow state="processing" title="请求已保存，AI 正在处理" />
        <AiRunWatcher runId={state.latestRun.id} />
      </> : null}
      {state.latestRun?.status === "failed" ? <>
        <AiSendDisclosure disclosure={disclosure} title="重试复盘时将发送" />
        <RecoveryAction
          code={state.latestRun.errorCode}
          safeDetail={state.latestRun.safeErrorDetail}
          retryAction={retryReviewReportAction}
          retryFields={{ reviewId, failedRunId: state.latestRun.id }}
          returnHref="/reviews/new"
        />
      </> : null}
      {!report && !state.latestRun ? <form action={generateReviewReportAction} className="compact-card compact-form"><input name="reviewId" type="hidden" value={reviewId} /><p>{query.notice === "not-configured" ? "复盘数据已保存，但当前未配置 AI 服务。" : "数据已保存，可以继续生成复盘。"}</p><AiSendDisclosure disclosure={disclosure} title="生成复盘时将发送" /><button className="compact-button" type="submit">生成复盘</button></form> : null}
      {report && state.latestSnapshot ? <>
        <nav aria-label="报告版本" className="compact-segmented">{state.reports.slice(0, 4).map((version) => <Link className="compact-segmented__item compact-segmented__link" data-active={version.version === report.version || undefined} href={`/reviews/${reviewId}/report?report=${version.reportId}&version=${version.version}`} key={version.id}>V{version.version}</Link>)}</nav>
        <p className="compact-message">{report.generationMode === "manual" ? "用户编辑版本" : "AI生成版本"} · 原始数据与计算结果分开呈现</p>
        {editing ? <form action={saveReviewReportAction} className="creation-plan-editor compact-form" id="review-report-editor">
          <input name="reviewId" type="hidden" value={reviewId} /><input name="reportId" type="hidden" value={report.reportId} /><input name="parentVersion" type="hidden" value={report.version} />
          {report.actions.map((action) => <fieldset className="compact-card compact-form" key={action.id}><legend>{action.title}</legend><label>任务名称<input name="actionTitle" defaultValue={action.title} /></label><label>为什么做<textarea name="actionReason" rows={2} defaultValue={action.reason} /></label><label>执行步骤<textarea name="actionSteps" rows={3} defaultValue={action.steps.join("\n")} /></label><label>完成标准<textarea name="actionCriteria" rows={2} defaultValue={action.completionCriteria} /></label></fieldset>)}
        </form> : <ReviewReportView confirmedMetrics={state.latestSnapshot.confirmedMetrics} calculatedMetrics={state.latestSnapshot.calculatedMetrics} report={report} citations={citations} legacySources={legacySources} />}
      </> : null}
      {query.notice && query.notice !== "not-configured" ? <p className="compact-message" data-error="true">操作未完成，已确认数据和现有报告未被覆盖。</p> : null}
    </div>
  </AppShell>;
}
