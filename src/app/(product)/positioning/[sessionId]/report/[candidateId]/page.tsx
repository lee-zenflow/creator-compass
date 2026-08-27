import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { CitationList } from "@/components/ui/citation-list";
import { resolveRunCitations } from "@/features/citations/citation-service";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { confirmCandidateAction } from "@/features/positioning/positioning-actions";
import { getActiveCreatorProfile, getPositioningCandidate } from "@/features/positioning/positioning-read-service";

export default async function CandidateDetailPage({ params, searchParams }: {
  params: Promise<{ sessionId: string; candidateId: string }>;
  searchParams: Promise<{ report?: string; version?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { sessionId, candidateId } = await params;
  const query = await searchParams;
  const version = Number(query.version);
  const result = query.report && Number.isInteger(version)
    ? await getPositioningCandidate(actor, query.report, version, candidateId).catch(() => null)
    : null;
  if (!result) notFound();
  const profile = await getActiveCreatorProfile(actor);
  const { candidate, report } = result;
  const citations = report.retrievalRecordId
    ? await resolveRunCitations(actor, report.retrievalRecordId, candidate.citations).catch(() => [])
    : [];
  return (
    <AppShell title="方案详情" backHref={`/positioning/${sessionId}/report`} bottomNav={false} rightAction={<span>V{report.version}</span>} stickyFooter={
      <form action={confirmCandidateAction}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="reportId" value={report.reportId} />
        <input type="hidden" name="reportVersion" value={report.version} />
        <input type="hidden" name="candidateId" value={candidate.id} />
        <input type="hidden" name="expectedProfileVersion" value={profile?.version ?? 0} />
        <button className="compact-button" type="submit">确认方向</button>
      </form>
    }>
      <article className="flow-content candidate-detail">
        <section><h2>{candidate.name}</h2><p>{candidate.direction}</p></section>
        <section><h3>为什么适合你</h3><p>{candidate.matchExplanation}</p><ul>{candidate.contentPillars.map((pillar) => <li key={pillar}>{pillar}</li>)}</ul></section>
        <section><h3>目标人群</h3><p>{candidate.audience}</p></section>
        <section><h3>参考依据</h3><CitationList citations={citations} emptyDetail="仅基于访谈信息，暂无匹配案例依据。" /></section>
        <section><h3>第一轮怎么做</h3><ul>{candidate.initialTasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul></section>
        {candidate.risks.length ? <section><h3>需要留意</h3><ul>{candidate.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
        {query.notice ? <p className="compact-message" data-error="true">确认未完成，请刷新后重试。</p> : null}
      </article>
    </AppShell>
  );
}
