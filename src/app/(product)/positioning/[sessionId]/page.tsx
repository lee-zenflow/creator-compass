import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { AiSendDisclosure } from "@/components/ui/ai-send-disclosure";
import { RecoveryAction } from "@/components/ui/recovery-action";
import { StatusRow } from "@/components/ui/status-row";
import { buildFallbackSendDisclosure, buildSendDisclosure } from "@/features/ai/send-disclosure";
import { recoveryFor } from "@/features/ai/recovery-contract";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import {
  requestPositioningReportAction,
  retryPositioningAction,
  sendInterviewAction,
} from "@/features/positioning/positioning-actions";
import { getPositioningFlow } from "@/features/positioning/positioning-read-service";
import { InterviewPanel } from "@/features/positioning/positioning-ui";

const notices: Record<string, string> = {
  not_configured: "AI 尚未配置，内容已保存；配置后可重试。",
  processing: "上一项生成仍在处理中。",
  failed: "操作失败，现有内容已保存。",
  conflict: "内容已更新，请刷新后重试。",
};

export default async function PositioningInterviewPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { sessionId } = await params;
  let flow;
  try { flow = await getPositioningFlow(actor, sessionId); }
  catch { notFound(); }
  const noticeKey = (await searchParams).notice;
  const readyReport = flow.latestReport?.status === "ready" && flow.latestReport.generationMode === "ai" ? flow.latestReport : null;
  const canGenerate = flow.session.completeness >= 80 && flow.latestRun?.status !== "processing";
  const failedRun = flow.latestRun?.status === "failed" ? flow.latestRun : null;
  const failedRecovery = failedRun ? recoveryFor(failedRun.errorCode, failedRun.safeErrorDetail) : null;
  const canRetryFailedRun =
    flow.latestRun?.status === "failed" &&
    recoveryFor(flow.latestRun.errorCode, flow.latestRun.safeErrorDetail).retryable;
  const coreInterviewComplete = flow.session.currentStep >= 10;
  const composerLabel = coreInterviewComplete ? "补充画像信息" : "输入你的回答";
  const composerAction = coreInterviewComplete ? "补充" : "发送";
  const [profileDisclosure, reportDisclosure] = await Promise.all([
    buildSendDisclosure(actor, "profile_extract", sessionId)
      .catch(() => buildFallbackSendDisclosure("profile_extract")),
    buildSendDisclosure(actor, "positioning_report", sessionId)
      .catch(() => buildFallbackSendDisclosure("positioning_report")),
  ]);
  const activeDisclosure = failedRun?.taskType === "positioning_report"
    ? reportDisclosure
    : profileDisclosure;
  return (
    <AppShell title="定位访谈" backHref="/positioning" bottomNav={false} rightAction={<Link className="compact-text-action" href="/positioning">保存</Link>} stickyFooter={
      <form className="interview-composer" action={sendInterviewAction}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="clientMessageId" value={crypto.randomUUID()} />
        <input name="message" required maxLength={4000} placeholder={composerLabel} aria-label={composerLabel} />
        <button className="compact-button" disabled={flow.latestRun?.status === "processing"} type="submit">{composerAction}</button>
      </form>
    }>
      <div className="flow-content compact-page">
        <InterviewPanel
          sessionId={sessionId}
          currentStep={flow.session.currentStep}
          completeness={flow.session.completeness}
          messages={flow.messages}
          latestRun={flow.latestRun}
          profileDimensions={flow.session.draft?.profileDimensions as Record<string, unknown> | undefined}
        />
        <AiSendDisclosure
          disclosure={activeDisclosure}
          title={failedRun?.taskType === "positioning_report" ? "重试定位报告时将发送" : "发送回答后将用于画像提取"}
        />
        {noticeKey && notices[noticeKey] ? <p className="compact-message" data-error="true">{notices[noticeKey]}</p> : null}
        {flow.latestRun?.status === "failed" ? (
          canRetryFailedRun ? (
            <RecoveryAction
              code={flow.latestRun.errorCode}
              safeDetail={flow.latestRun.safeErrorDetail}
              retryAction={retryPositioningAction}
              retryFields={{
                sessionId,
                failedRunId: flow.latestRun.id,
                idempotencyKey: `retry:${flow.latestRun.id}`,
              }}
              returnHref={`/positioning/${sessionId}`}
            />
          ) : failedRecovery ? (
            <StatusRow state="error" title={failedRecovery.title} detail={failedRecovery.detail} />
          ) : null
        ) : null}
        {readyReport ? (
          <section className="report-ready compact-card">
            <strong>定位报告已生成</strong>
            <p>{readyReport.evidence?.length
              ? "报告包含 3 个候选方向，内容来自本次访谈与已审核资料。"
              : "报告包含 3 个候选方向，仅基于本次访谈信息，暂无匹配案例依据。"}</p>
            <Link className="compact-button" href={`/positioning/${sessionId}/report?report=${readyReport.reportId}&version=${readyReport.version}`}>查看候选方案</Link>
          </section>
        ) : canGenerate ? (
          <section className="report-ready compact-card">
            <strong>资料已支持生成定位报告</strong>
            <p>你可以现在生成，也可以继续补充信息。</p>
            <form action={requestPositioningReportAction}>
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="idempotencyKey" value={`report:${crypto.randomUUID()}`} />
              <AiSendDisclosure disclosure={reportDisclosure} title="生成定位报告时将发送" />
              <button className="compact-button" type="submit">生成报告</button>
            </form>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
