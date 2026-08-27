import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { getPositioningReportForSession } from "@/features/positioning/positioning-read-service";
import { positioningReportOutputSchema } from "@/features/positioning/positioning-schemas";
import { CandidateCards } from "@/features/positioning/positioning-ui";

export default async function PositioningReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ report?: string; version?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { sessionId } = await params;
  const query = await searchParams;
  const version = query.version ? Number(query.version) : undefined;
  const source = query.report && Number.isInteger(version) && (version ?? 0) > 0
    ? { reportId: query.report, version: version as number }
    : undefined;
  if ((query.report || query.version) && !source) notFound();
  const report = await getPositioningReportForSession(actor, sessionId, source).catch(() => null);
  if (!report || report.status !== "ready") notFound();
  const parsed = positioningReportOutputSchema.safeParse({ candidates: report.candidates });
  if (!parsed.success) notFound();
  return (
    <AppShell title="候选方案" backHref={`/positioning/${sessionId}`} bottomNav={false} stickyFooter={
      <a className="compact-button" data-variant="secondary" href={`/positioning/${sessionId}`}>返回访谈继续补充</a>
    }>
      <div className="flow-content compact-page">
        <section className="candidate-summary"><strong>为你生成 3 个定位方向</strong><span>报告 V{report.version} · 点击任一方向查看完整方案。</span></section>
        <CandidateCards sessionId={sessionId} reportId={report.reportId} reportVersion={report.version} candidates={parsed.data.candidates} />
      </div>
    </AppShell>
  );
}
