import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  return <Suspense fallback={<div className="admin-loading">正在打开运营后台…</div>}><AdminShell title="知识运营">{children}</AdminShell></Suspense>;
}
