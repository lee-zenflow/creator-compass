"use client";

import { ArrowUpDown, CheckCheck, ListChecks, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { TaskStatus } from "./task-service";
import { TaskCard, TaskSubmitButton } from "./task-card";

type TaskAction = (formData: FormData) => void | Promise<void>;
export type TaskListItem = {
  id: string; title: string; plannedDate: string; today: string; estimatedMinutes: number; status: TaskStatus;
  completionCriteria?: string; priority?: 1 | 2 | 3; sourceType?: "positioning" | "creation" | "review"; sourceHref?: string;
};

export function updateTaskSelection(current: string[], id: string, checked: boolean) {
  if (!checked) return current.filter((item) => item !== id);
  if (current.includes(id) || current.length >= 50) return current;
  return [...current, id];
}

export function TaskList({ tasks, startAction, completeAction, restoreAction, batchAction, moveAction, range, status }: {
  tasks: TaskListItem[]; startAction: TaskAction; completeAction: TaskAction; restoreAction: TaskAction; batchAction: TaskAction; moveAction: TaskAction;
  range: "today" | "week" | "all"; status: TaskStatus | "all";
}) {
  const [mode, setMode] = useState<"default" | "select" | "reorder">("default");
  const selecting = mode === "select";
  const reordering = mode === "reorder";
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedTasks = tasks.filter((task) => selectedSet.has(task.id));
  const restoring = selectedTasks.length > 0 && selectedTasks.every((task) => task.status === "completed");
  const groups = useMemo(() => {
    const byDate = new Map<string, TaskListItem[]>();
    for (const task of tasks) byDate.set(task.plannedDate, [...(byDate.get(task.plannedDate) ?? []), task]);
    return [...byDate.entries()];
  }, [tasks]);

  function leaveSelection() { setSelected([]); setMode("default"); }
  function selectTask(id: string, checked: boolean) {
    setSelected((current) => updateTaskSelection(current, id, checked));
  }

  return <div className="task-list">
    <header className="task-list__toolbar">
      <span>{selecting ? `已选择 ${selected.length}/50 项` : `共 ${tasks.length} 项`}</span>
      <span className="task-list__mode-group">
        <button aria-label={selecting ? "退出选择" : "选择任务"} className="task-list__mode" onClick={() => selecting ? leaveSelection() : setMode("select")} type="button">{selecting ? <X aria-hidden="true" size={16} /> : <ListChecks aria-hidden="true" size={16} />}{selecting ? "取消" : "选择任务"}</button>
        {!selecting && status === "all" ? <button aria-label={reordering ? "退出排序" : "调整顺序"} className="task-list__mode" onClick={() => setMode(reordering ? "default" : "reorder")} type="button">{reordering ? <X aria-hidden="true" size={16} /> : <ArrowUpDown aria-hidden="true" size={16} />}{reordering ? "完成排序" : "调整顺序"}</button> : null}
      </span>
    </header>
    {groups.map(([date, dateTasks]) => <section aria-label={`${date} 的任务`} className="task-date-group" key={date}>
      <header className="task-date-group__label"><time dateTime={date}>{dateTasks[0]?.today === date ? "今天" : date}</time><span>{dateTasks.length}</span></header>
      <div className="compact-stack">
        {dateTasks.map((task) => {
          const movableTasks = dateTasks.filter((item) => item.status !== "dismissed");
          const movableIndex = movableTasks.findIndex((item) => item.id === task.id);
          return <TaskCard
          {...task}
          canMoveDown={movableIndex >= 0 && movableIndex < movableTasks.length - 1}
          canMoveUp={movableIndex > 0}
          completeAction={completeAction}
          key={task.id}
          moveAction={moveAction}
          onSelectedChange={(checked) => selectTask(task.id, checked)}
          restoreAction={restoreAction}
          selected={selectedSet.has(task.id)}
          selecting={selecting}
          selectionDisabled={task.status === "dismissed" || (selected.length >= 50 && !selectedSet.has(task.id))}
          startAction={startAction}
          range={range}
          filterStatus={status}
          showMoveControls={reordering}
          showStateControls={!reordering}
        />;})}
      </div>
    </section>)}
    {selected.length > 0 ? <form action={batchAction} className="task-batch-bar">
      {selected.map((id) => <input key={id} name="taskIds" type="hidden" value={id} />)}
      <input name="targetStatus" type="hidden" value={restoring ? "pending" : "completed"} />
      <input name="range" type="hidden" value={range} />
      <input name="status" type="hidden" value={status} />
      <span>{selected.length} 项任务</span>
      <TaskSubmitButton className="task-batch-bar__action">
        {restoring ? <RotateCcw aria-hidden="true" size={16} /> : <CheckCheck aria-hidden="true" size={16} />}
        {restoring ? "恢复所选任务" : "完成所选任务"}
      </TaskSubmitButton>
    </form> : null}
  </div>;
}
