import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { getWorkspace } from "@/features/workspace/workspace-service";
import { WorkspaceView } from "@/features/workspace/workspace-view";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  let actor;
  try {
    actor = await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
  const requested = Number((await searchParams).range);
  const range = requested === 3 || requested === 30 ? requested : 7;
  const view = await getWorkspace(actor, range);

  return (
    <AppShell title="工作台" coordinate="TODAY · POSITION" activeTab="workspace">
      <div className="flow-content"><WorkspaceView view={view} /></div>
    </AppShell>
  );
}
