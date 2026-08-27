import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { listFailedAiRuns } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

export default async function FailedAiRunsPage() {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  const items = await listFailedAiRuns(actor);
  return <AppShell title="AI 失败任务" backHref="/admin" bottomNav={false}><div className="flow-content compact-list">{items.length ? items.map((item) => <article className="compact-card admin-row" key={String(item.id)}><span><strong>{String(item.taskType)} · {String(item.errorCode ?? "UNKNOWN")}</strong><small>{String(item.model)} · {String(item.durationMs ?? "-")}ms · token {String(item.inputTokens ?? 0)}/{String(item.outputTokens ?? 0)}</small></span><em>{new Date(String(item.createdAt)).toLocaleString("zh-CN")}</em></article>) : <p className="compact-empty">暂无失败任务</p>}</div></AppShell>;
}
