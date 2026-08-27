import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { listRules } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

export default async function RulesAdminPage() {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  const items = await listRules(actor);
  return <AppShell title="平台规则" backHref="/admin" bottomNav={false}><div className="flow-content compact-list">{items.length ? items.map((item) => <article className="compact-card admin-row" key={String(item.id)}><span><strong>{String(item.platform)} · {String(item.ruleType)}</strong><small>{String(item.authority)}</small></span><em>{String(item.reviewStatus)} / {String(item.retrievalScope)} / {item.enabled ? "启用" : "停用"}</em></article>) : <p className="compact-empty">暂无规则</p>}</div></AppShell>;
}
