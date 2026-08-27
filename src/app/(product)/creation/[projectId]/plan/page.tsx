import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { AiSendDisclosure } from "@/components/ui/ai-send-disclosure";
import { RecoveryAction } from "@/components/ui/recovery-action";
import { StatusRow } from "@/components/ui/status-row";
import { buildFallbackSendDisclosure, buildSendDisclosure } from "@/features/ai/send-disclosure";
import { regenerateContentPlanAction, retryContentPlanAction, saveContentPlanAction } from "@/features/creation/creation-actions";
import { getCreationPlanState, getCreationPlanVersion } from "@/features/creation/creation-read-service";
import { ContentPlanView } from "@/features/creation/creation-ui";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { resolveRunCitations } from "@/features/citations/citation-service";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { AiRunWatcher } from "@/features/positioning/ai-run-watcher";

function EditFields({ plan }: { plan: Awaited<ReturnType<typeof getCreationPlanVersion>>["content"] }) {
  const common = <>
    <label>风险提醒<textarea name="riskNotes" rows={3} defaultValue={plan.riskNotes.join("\n")} /></label>
    <input name="tasksJson" type="hidden" value={JSON.stringify(plan.tasks)} />
    <input name="citationsJson" type="hidden" value={JSON.stringify(plan.citations)} />
  </>;
  if (plan.contentType === "video") return <><label>开头钩子<textarea name="hooks" rows={3} defaultValue={plan.hooks.join("\n")} /></label><label>分镜<textarea name="storyboard" rows={5} defaultValue={plan.storyboard.join("\n")} /></label><label>口播稿<textarea name="voiceover" rows={10} defaultValue={plan.voiceover} /></label><label>拍摄步骤<textarea name="shootingSteps" rows={4} defaultValue={plan.shootingSteps.join("\n")} /></label>{common}</>;
  if (plan.contentType === "article") return <><label>标题建议<textarea name="titleSuggestions" rows={3} defaultValue={plan.titleSuggestions.join("\n")} /></label><label>正文结构<textarea name="outline" rows={5} defaultValue={plan.outline.join("\n")} /></label><label>完整正文<textarea name="body" rows={12} defaultValue={plan.body} /></label><label>配图建议<textarea name="imageSuggestions" rows={4} defaultValue={plan.imageSuggestions.join("\n")} /></label>{common}</>;
  return <><label>标题建议<textarea name="titleSuggestions" rows={3} defaultValue={plan.titleSuggestions.join("\n")} /></label><label>完整文案<textarea name="body" rows={12} defaultValue={plan.body} /></label><label>发布引导<textarea name="publishingGuide" rows={4} defaultValue={plan.publishingGuide.join("\n")} /></label>{common}</>;
}

export default async function CreationPlanPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ report?: string; version?: string; edit?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const { projectId } = await params;
  const query = await searchParams;
  const state = await getCreationPlanState(actor, projectId).catch(() => null);
  if (!state) notFound();
  const requestedVersion = query.report && Number.isInteger(Number(query.version))
    ? await getCreationPlanVersion(actor, query.report, Number(query.version)).catch(() => null)
    : null;
  const plan = requestedVersion ?? state.latestPlan;
  const citations = plan?.retrievalRecordId
    ? await resolveRunCitations(actor, plan.retrievalRecordId, plan.content.citations).catch(() => [])
    : [];
  const editing = query.edit === "1" && Boolean(plan);
  const disclosure = await buildSendDisclosure(actor, "content_plan", projectId)
    .catch(() => buildFallbackSendDisclosure("content_plan"));
  const footer = plan ? editing ? <><Link className="compact-button" data-variant="secondary" href={`/creation/${projectId}/plan?report=${plan.reportId}&version=${plan.version}`}>取消</Link><button className="compact-button" form="content-plan-editor" type="submit">保存新版本</button></> : <><Link className="compact-button" data-variant="secondary" href={`/creation/${projectId}/plan?report=${plan.reportId}&version=${plan.version}&edit=1`}>编辑方案</Link><Link className="compact-button" href={`/creation/${projectId}/tasks?report=${plan.reportId}&version=${plan.version}`}>预览执行任务</Link></> : undefined;
  return (
    <AppShell title="内容方案" backHref={`/creation/${projectId}/materials`} bottomNav={false} stickyFooter={footer}>
      <div className="flow-content compact-page">
        {!plan && state.latestRun?.status === "processing" ? <>
          <StatusRow state="processing" title="请求已保存，AI 正在处理" />
          <AiRunWatcher runId={state.latestRun.id} />
        </> : null}
        {state.latestRun?.status === "failed" ? <>
          <AiSendDisclosure disclosure={disclosure} title="重试内容方案时将发送" />
          <RecoveryAction
            code={state.latestRun.errorCode}
            safeDetail={state.latestRun.safeErrorDetail}
            retryAction={retryContentPlanAction}
            retryFields={{ projectId, failedRunId: state.latestRun.id }}
            returnHref={`/creation/${projectId}/materials`}
          />
        </> : null}
        {!plan && !state.latestRun ? <div className="compact-empty">还没有开始生成内容方案</div> : null}
        {plan ? <>
          <nav className="compact-segmented" aria-label="方案版本">{state.plans.slice(0, 4).map((version) => <Link className="compact-segmented__item compact-segmented__link" data-active={version.version === plan.version || undefined} href={`/creation/${projectId}/plan?report=${version.reportId}&version=${version.version}`} key={version.id}>V{version.version}</Link>)}</nav>
          <p className="compact-message">{plan.generationMode === "manual" ? "用户编辑版本" : "AI 生成版本"} · 档案 V{plan.sourceSnapshot.profileVersion ?? "-"} · {plan.sourceSnapshot.materialIds.length} 项素材</p>
          {state.latestRun?.status === "processing" ? <><StatusRow state="processing" title="请求已保存，AI 正在处理" detail="当前已保存版本仍可查看" /><AiRunWatcher runId={state.latestRun.id} /></> : null}
          {state.latestRun?.status !== "processing" && state.latestRun?.status !== "failed" && !editing ? <form action={regenerateContentPlanAction} className="compact-form"><input name="projectId" type="hidden" value={projectId} /><input name="sourceVersion" type="hidden" value={plan.version} /><AiSendDisclosure disclosure={disclosure} title="重新生成时将发送" /><button className="compact-text-action" type="submit">重新生成新版本</button></form> : null}
          {editing ? <form action={saveContentPlanAction} className="creation-plan-editor compact-form" id="content-plan-editor">
            <input name="projectId" type="hidden" value={projectId} /><input name="reportId" type="hidden" value={plan.reportId} /><input name="parentVersion" type="hidden" value={plan.version} /><input name="contentType" type="hidden" value={plan.content.contentType} />
            <EditFields plan={plan.content} />
          </form> : <ContentPlanView plan={plan.content} citations={citations} />}
        </> : null}
        {query.notice ? <p className="compact-message" data-error="true">操作未完成，现有方案未被覆盖。</p> : null}
      </div>
    </AppShell>
  );
}
