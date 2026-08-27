import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { commitCreationTasksAction } from "@/features/creation/creation-actions";
import { getCreationPlanVersion } from "@/features/creation/creation-read-service";
import { CreationTaskRows } from "@/features/creation/creation-ui";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";

export default async function CreationTasksPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ report?: string; version?: string; notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const { projectId } = await params;
  const query = await searchParams;
  const version = Number(query.version);
  const plan = query.report && Number.isInteger(version) ? await getCreationPlanVersion(actor, query.report, version).catch(() => null) : null;
  if (!plan || plan.projectId !== projectId) notFound();
  return (
    <AppShell title="任务预览" backHref={`/creation/${projectId}/plan?report=${plan.reportId}&version=${plan.version}`} bottomNav={false} stickyFooter={<button className="compact-button" form="creation-tasks" type="submit">写入任务中心</button>}>
      <form action={commitCreationTasksAction} className="flow-content compact-page" id="creation-tasks">
        <input name="projectId" type="hidden" value={projectId} /><input name="reportId" type="hidden" value={plan.reportId} /><input name="version" type="hidden" value={plan.version} />
        <p className="compact-message">默认选中全部任务，可取消不准备执行的项。</p>
        <CreationTaskRows tasks={plan.content.tasks} />
        {query.notice ? <p className="compact-message" data-error="true">任务未写入，请至少选择一项后重试。</p> : null}
      </form>
    </AppShell>
  );
}
