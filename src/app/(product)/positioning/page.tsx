import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { createPositioningSessionAction } from "@/features/positioning/positioning-actions";
import { listPositioningRecords } from "@/features/positioning/positioning-read-service";
import { PositioningRecordList } from "@/features/positioning/positioning-ui";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";

export default async function PositioningPage() {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const records = await listPositioningRecords(actor);
  return (
    <AppShell title="定位记录" backHref="/tools" bottomNav={false} stickyFooter={
      <form action={createPositioningSessionAction}><button className="compact-button" type="submit">新建定位</button></form>
    }>
      <div className="flow-content"><PositioningRecordList records={records} /></div>
    </AppShell>
  );
}
