import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { activatePromptAction } from "@/features/admin/admin-actions";
import { listPrompts } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

export default async function PromptsAdminPage() {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  const items = await listPrompts(actor);
  return <AppShell title="提示词版本" backHref="/admin" bottomNav={false}><div className="flow-content compact-list">{items.map((item) => <article className="compact-card admin-row" key={String(item.id)}><span><strong>{String(item.taskType)} · V{String(item.version)}</strong><small>{item.enabled ? "当前启用" : "历史版本"}</small></span>{item.enabled ? null : <form action={activatePromptAction}><input type="hidden" name="promptId" value={String(item.id)} /><button type="submit">切换到此版本</button></form>}</article>)}</div></AppShell>;
}
