import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { listPlatformAccountLabels } from "@/features/workspace/platform-account-service";
import { PlatformAccountsView } from "@/features/workspace/platform-accounts-view";

export default async function PlatformAccountsPage({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const query = await searchParams;
  const accounts = await listPlatformAccountLabels(actor);
  return <AppShell title="平台账号" backHref="/me" bottomNav={false}>
    <div className="flow-content compact-page">
      <PlatformAccountsView accounts={accounts} next={query.next ?? ""} notice={query.notice ?? null} />
    </div>
  </AppShell>;
}
