import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { commitPositioningTasksAction } from "@/features/positioning/positioning-actions";
import { getConfirmedPositioningCandidate } from "@/features/positioning/positioning-read-service";
import { PositioningTaskCards } from "@/features/positioning/positioning-ui";

export default async function PositioningTasksPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ report?: string; version?: string; candidate?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { sessionId } = await params;
  const query = await searchParams;
  const version = Number(query.version);
  const result = query.report && query.candidate && Number.isInteger(version)
    ? await getConfirmedPositioningCandidate(actor, query.report, version, query.candidate).catch(() => null)
    : null;
  if (!result) notFound();
  return (
    <AppShell title="任务预览" backHref={`/positioning/${sessionId}/report`} bottomNav={false} stickyFooter={
      <><Link className="compact-button" data-variant="secondary" href="/workspace">稍后处理</Link><button className="compact-button" form="positioning-task-form" type="submit">写入任务中心</button></>
    }>
      <div className="flow-content compact-page">
        <section className="positioning-updated compact-card"><strong>定位已写入创作档案</strong><span>当前定位已更新为“{result.candidate.name}”。</span></section>
        <section className="task-goal"><strong>目标：完成首轮方向验证</strong><span>默认勾选未来 3 天内高优先级且可执行的任务。</span></section>
        <form action={commitPositioningTasksAction} id="positioning-task-form">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="reportId" value={result.report.reportId} />
          <input type="hidden" name="reportVersion" value={result.report.version} />
          <input type="hidden" name="candidateId" value={result.candidate.id} />
          <PositioningTaskCards tasks={result.candidate.initialTasks} />
        </form>
        {query.notice ? <p className="compact-message" data-error="true">任务未写入，请至少选择一项后重试。</p> : null}
      </div>
    </AppShell>
  );
}
