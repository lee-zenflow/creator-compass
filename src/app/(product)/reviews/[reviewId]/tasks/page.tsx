import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { commitReviewTasksAction } from "@/features/reviews/review-actions";
import { getReviewReportVersion } from "@/features/reviews/review-read-service";
import { ReviewTaskRows } from "@/features/reviews/review-ui";

export default async function ReviewTasksPage({ params, searchParams }: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<{ report?: string; version?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const { reviewId } = await params;
  const query = await searchParams;
  const version = Number(query.version);
  const report = query.report && Number.isInteger(version)
    ? await getReviewReportVersion(actor, query.report, version).catch(() => null)
    : null;
  if (!report || report.reviewId !== reviewId) notFound();
  return <AppShell title="改进任务" backHref={`/reviews/${reviewId}/report?report=${report.reportId}&version=${report.version}`} bottomNav={false} stickyFooter={<button className="compact-button" form="review-task-form" type="submit">写入任务中心</button>}>
    <form action={commitReviewTasksAction} className="flow-content compact-page" id="review-task-form">
      <input name="reviewId" type="hidden" value={reviewId} /><input name="reportId" type="hidden" value={report.reportId} /><input name="version" type="hidden" value={report.version} />
      <p className="compact-message">默认全部选中，可取消不需要的行动。</p>
      <ReviewTaskRows tasks={report.actions} />
      {query.notice ? <p className="compact-message" data-error="true">写入失败，没有创建重复任务。</p> : null}
    </form>
  </AppShell>;
}
