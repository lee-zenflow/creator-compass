import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { batchTaskStatusAction, completeTaskAction, moveTaskAction, restoreTaskAction, startTaskAction } from "@/features/tasks/task-actions";
import { TaskList, type TaskListItem } from "@/features/tasks/task-list";
import { listTasks, type TaskFilter, type TaskStatus } from "@/features/tasks/task-service";
import { taskSourceHref } from "@/features/tasks/task-source-link";

const ranges = [{ id: "today", label: "今天" }, { id: "week", label: "本周" }, { id: "all", label: "全部" }] as const;
const statuses = [{ id: "all", label: "全部" }, { id: "pending", label: "待开始" }, { id: "in_progress", label: "进行中" }, { id: "completed", label: "已完成" }, { id: "dismissed", label: "已取消" }] as const;
const notices: Record<string, { message: string; error?: boolean }> = {
  invalid: { message: "任务信息无效，请刷新后重试。", error: true }, conflict: { message: "任务状态已变化，请刷新后重试。", error: true }, failed: { message: "操作未完成，现有任务没有被覆盖。", error: true },
  started: { message: "任务已开始。" }, completed: { message: "任务已完成。" }, restored: { message: "任务已恢复为待开始。" }, moved: { message: "任务顺序已更新。" },
};

function taskFilterHref(range: NonNullable<TaskFilter["range"]>, status: TaskStatus | "all") {
  const query = new URLSearchParams({ range });
  if (status !== "all") query.set("status", status);
  return `/tasks?${query.toString()}`;
}

function todayInProductTimezone() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ range?: string; status?: string; notice?: string }> }) {
  let actor: CurrentActor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const query = await searchParams;
  const range: NonNullable<TaskFilter["range"]> = query.range === "today" || query.range === "week" ? query.range : "all";
  const status: TaskStatus | "all" = statuses.some((item) => item.id === query.status) ? query.status as TaskStatus | "all" : "all";
  const taskRecords = await listTasks(actor, { range, status: status === "all" ? undefined : status });
  const today = todayInProductTimezone();
  const items: TaskListItem[] = taskRecords.map((task) => ({
    id: task.id, title: task.title, plannedDate: task.plannedDate, today, estimatedMinutes: task.estimatedMinutes,
    status: task.status, completionCriteria: task.completionCriteria, priority: task.priority, sourceType: task.sourceSnapshot.report.type,
    sourceHref: taskSourceHref({ type: task.sourceSnapshot.report.type, entityId: task.sourceSnapshot.typedVersion.entityId ?? null, reportId: task.sourceReportId, version: task.sourceVersion }),
  }));
  const notice = query.notice ? notices[query.notice] : undefined;

  return <AppShell title="任务中心" activeTab="tasks"><div className="flow-content compact-page task-page">
    {notice ? <p className="compact-message" data-error={notice.error || undefined} role="status">{notice.message}</p> : null}
    <nav className="compact-segmented" aria-label="任务日期筛选">{ranges.map((item) => <Link className="compact-segmented__item compact-segmented__link" data-active={range === item.id || undefined} href={taskFilterHref(item.id, status)} key={item.id}>{item.label}</Link>)}</nav>
    <nav className="compact-segmented compact-segmented--status" aria-label="任务状态筛选">{statuses.map((item) => <Link className="compact-segmented__item compact-segmented__link" data-active={status === item.id || undefined} href={taskFilterHref(range, item.id)} key={item.id}>{item.label}</Link>)}</nav>
    {items.length === 0 ? <CompactEmptyState action={{ href: "/tools", label: "去工具箱" }} icon="tasks" title="当前筛选下没有任务" detail="调整日期或状态，或从创作方案生成任务" /> : <TaskList key={`${range}:${status}`} tasks={items} range={range} status={status} startAction={startTaskAction} completeAction={completeTaskAction} restoreAction={restoreTaskAction} batchAction={batchTaskStatusAction} moveAction={moveTaskAction} />}
  </div></AppShell>;
}
