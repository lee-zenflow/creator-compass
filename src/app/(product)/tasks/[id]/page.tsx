import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { TASK_SOURCE_ICONS } from "@/features/navigation/module-icons";
import { completeTaskAction, deleteTaskAction, restoreTaskAction, updateTaskAction } from "@/features/tasks/task-actions";
import { TaskSubmitButton } from "@/features/tasks/task-card";
import { taskSourceHref } from "@/features/tasks/task-source-link";
import { getTask, type TaskStatus } from "@/features/tasks/task-service";

const TASK_SOURCE_LABELS: Record<keyof typeof TASK_SOURCE_ICONS, string> = {
  positioning: "定位报告",
  creation: "创作方案",
  review: "复盘报告",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  dismissed: "已取消",
};

export default async function TaskDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  let actor: CurrentActor;
  try {
    actor = await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
  const { id } = await params;
  let task;
  try {
    task = await getTask(actor, id);
  } catch {
    notFound();
  }
  const editing = (await searchParams).edit === "1";
  const sourceType = task.sourceSnapshot.report.type;
  const SourceIcon = TASK_SOURCE_ICONS[sourceType];
  const sourceHref = taskSourceHref({
    type: sourceType,
    entityId: task.sourceSnapshot.typedVersion.entityId ?? null,
    reportId: task.sourceReportId,
    version: task.sourceVersion,
  });

  if (editing) {
    return (
      <AppShell
        title="编辑任务"
        backHref={`/tasks/${task.id}`}
        bottomNav={false}
        stickyFooter={<Button className="w-full" form="task-edit-form" type="submit">保存调整</Button>}
      >
        <form action={updateTaskAction} className="flow-content compact-form compact-card" id="task-edit-form">
          <input name="taskId" type="hidden" value={task.id} />
          <label>任务名称<input name="title" defaultValue={task.title} required maxLength={120} /></label>
          <label>为什么做<textarea name="reason" defaultValue={task.reason} required rows={2} /></label>
          <label>执行步骤<textarea name="steps" defaultValue={task.steps.join("\n")} required rows={4} /></label>
          <div className="compact-form__row">
            <label>计划日期<input name="plannedDate" type="date" defaultValue={task.plannedDate} required /></label>
            <label>预计分钟<input name="estimatedMinutes" type="number" min={5} max={1440} defaultValue={task.estimatedMinutes} required /></label>
          </div>
          <label>完成标准<textarea name="completionCriteria" defaultValue={task.completionCriteria} required rows={2} /></label>
          <label>优先级<select name="priority" defaultValue={task.priority}><option value="1">高</option><option value="2">中</option><option value="3">低</option></select></label>
        </form>
      </AppShell>
    );
  }
  const footer = (
    <>
      <form action={deleteTaskAction}>
        <input name="taskId" type="hidden" value={task.id} />
        <TaskSubmitButton className="w-full" variant="secondary">删除</TaskSubmitButton>
      </form>
      {task.status !== "dismissed" ? <form action={task.status === "completed" ? restoreTaskAction : completeTaskAction}>
        <input name="taskId" type="hidden" value={task.id} />
        <input name="range" type="hidden" value="all" />
        <input name="status" type="hidden" value="all" />
        <TaskSubmitButton className="w-full">{task.status === "completed" ? "恢复任务" : "标记完成"}</TaskSubmitButton>
      </form> : null}
    </>
  );

  return (
    <AppShell title="任务详情" backHref="/tasks" bottomNav={false} rightAction={<Link className="compact-text-action" href={`/tasks/${task.id}?edit=1`}>编辑</Link>} stickyFooter={footer}>
      <article className="flow-content compact-page task-detail">
        <header className="compact-card">
          <Link aria-label={`来源：${TASK_SOURCE_LABELS[sourceType]} V${task.sourceVersion}`} className="record-source" href={sourceHref}>
            <SourceIcon aria-hidden="true" size={16} strokeWidth={1.8} />
            {TASK_SOURCE_LABELS[sourceType]} · V{task.sourceVersion}
          </Link>
          <small>{task.plannedDate} · {task.estimatedMinutes} 分钟 · {TASK_STATUS_LABELS[task.status]}</small>
          <h2>{task.title}</h2>
          <span>{task.priority === 1 ? "高" : task.priority === 2 ? "中" : "低"}优先级</span>
        </header>
        <section><h3>为什么做</h3><p>{task.reason}</p></section>
        <section><h3>执行步骤</h3><ol>{task.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
        <section><h3>完成标准</h3><p>{task.completionCriteria}</p></section>
      </article>
    </AppShell>
  );
}
