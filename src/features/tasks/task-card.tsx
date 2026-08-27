"use client";

import { Check, ChevronDown, ChevronUp, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { TASK_SOURCE_ICONS } from "@/features/navigation/module-icons";
import type { TaskStatus } from "./task-service";

type TaskSourceType = keyof typeof TASK_SOURCE_ICONS;
type TaskAction = (formData: FormData) => void | Promise<void>;
type FilterContext = { range: "today" | "week" | "all"; status: TaskStatus | "all" };
const sourceLabels: Record<TaskSourceType, string> = { positioning: "定位报告", creation: "创作方案", review: "复盘报告" };
const statusLabels: Record<TaskStatus, string> = { pending: "待开始", in_progress: "进行中", completed: "已完成", dismissed: "已取消" };

function ContextFields({ context }: { context: FilterContext }) {
  return <><input name="range" type="hidden" value={context.range} /><input name="status" type="hidden" value={context.status} /></>;
}

function PendingIconButton({ label, children }: { label: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <button aria-busy={pending || undefined} aria-label={label} className="task-icon-action" disabled={pending} type="submit">{children}</button>;
}

function MoveButton({ disabled, label, value, children }: { disabled: boolean; label: string; value: "up" | "down"; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <button aria-busy={pending || undefined} aria-label={label} className="task-icon-action" disabled={disabled || pending} name="direction" type="submit" value={value}>{children}</button>;
}

function ActionButton({ action, context, id, label, children }: { action: TaskAction; context: FilterContext; id: string; label: string; children: ReactNode }) {
  return <form action={action}><input name="taskId" type="hidden" value={id} /><ContextFields context={context} /><PendingIconButton label={label}>{children}</PendingIconButton></form>;
}

export function TaskSubmitButton({ children, className, variant = "primary" }: { children: ReactNode; className?: string; variant?: "primary" | "secondary" | "ghost" }) {
  const { pending } = useFormStatus();
  return <Button aria-busy={pending || undefined} className={className} disabled={pending} type="submit" variant={variant}>{pending ? "处理中…" : children}</Button>;
}

export function TaskCard({ id, title, plannedDate, today: todayProp, estimatedMinutes, status: statusProp, completed, onCompletedChange, completionCriteria, priority, sourceType, sourceHref, canMoveUp = false, canMoveDown = false, selecting = false, selected = false, selectionDisabled = false, onSelectedChange, startAction, completeAction, restoreAction, moveAction, range = "all", filterStatus = "all", showStateControls = true, showMoveControls = true }: {
  id?: string; title: string; plannedDate: string; today?: string; estimatedMinutes: number; status?: TaskStatus; completed?: boolean; onCompletedChange?: (completed: boolean) => void;
  completionCriteria?: string; priority?: 1 | 2 | 3; sourceType?: TaskSourceType; sourceHref?: string; canMoveUp?: boolean; canMoveDown?: boolean;
  selecting?: boolean; selected?: boolean; selectionDisabled?: boolean; onSelectedChange?: (selected: boolean) => void;
  startAction?: TaskAction; completeAction?: TaskAction; restoreAction?: TaskAction; moveAction?: TaskAction;
  range?: FilterContext["range"]; filterStatus?: FilterContext["status"]; showStateControls?: boolean; showMoveControls?: boolean;
}) {
  const status = statusProp ?? (completed ? "completed" : "pending");
  const today = todayProp ?? plannedDate;
  const context = { range, status: filterStatus };
  const SourceIcon = sourceType ? TASK_SOURCE_ICONS[sourceType] : null;
  const overdue = plannedDate < today && status !== "completed" && status !== "dismissed";
  const dateLabel = overdue ? "已逾期" : plannedDate === today ? "今天" : plannedDate;
  const copy = <span className="task-card__copy"><strong className="task-card__title">{title}</strong><span className="task-card__meta"><span className={overdue ? "task-card__overdue" : undefined}>{dateLabel}</span> · {estimatedMinutes} 分钟 · <span className="record-status">{statusLabels[status]}</span></span>{completionCriteria ? <span className="task-card__criteria line-clamp-1">完成标准：{completionCriteria}</span> : null}</span>;

  return <article className="task-card" data-completed={status === "completed" || undefined}>
    {selecting ? <label className="task-card__select"><input aria-label={`选择 ${title}`} checked={selected} disabled={selectionDisabled} onChange={(event) => onSelectedChange?.(event.target.checked)} type="checkbox" /><span aria-hidden="true" /></label> : null}
    {id ? <Link className="task-card__detail-link" href={`/tasks/${id}`}>{copy}</Link> : <span className="task-card__detail-link">{copy}</span>}
    {SourceIcon && sourceType ? sourceHref ? <Link aria-label={`查看来源：${sourceLabels[sourceType]}`} className="task-card__source-link" href={sourceHref}><SourceIcon aria-hidden="true" size={16} strokeWidth={1.8} /></Link> : <span aria-label={`来源：${sourceLabels[sourceType]}`} className="task-card__source-link"><SourceIcon aria-hidden="true" size={16} strokeWidth={1.8} /></span> : null}
    {!id && onCompletedChange ? <label className="task-card__select"><input aria-label={`完成 ${title}`} checked={status === "completed"} onChange={(event) => onCompletedChange(event.target.checked)} type="checkbox" /><span aria-hidden="true" /></label> : null}
    {!selecting && id && status !== "dismissed" ? <div className="task-card__actions">
      {showStateControls && status === "pending" && startAction ? <ActionButton action={startAction} context={context} id={id} label={`开始 ${title}`}><Play aria-hidden="true" size={16} /></ActionButton> : null}
      {showStateControls && (status === "pending" || status === "in_progress") && completeAction ? <ActionButton action={completeAction} context={context} id={id} label={`完成 ${title}`}><Check aria-hidden="true" size={16} /></ActionButton> : null}
      {showStateControls && status === "completed" && restoreAction ? <ActionButton action={restoreAction} context={context} id={id} label={`恢复 ${title}`}><RotateCcw aria-hidden="true" size={16} /></ActionButton> : null}
      {showMoveControls && moveAction ? <><form action={moveAction}><input name="taskId" type="hidden" value={id} /><ContextFields context={context} /><MoveButton disabled={!canMoveUp} label={`上移 ${title}`} value="up"><ChevronUp aria-hidden="true" size={16} /></MoveButton></form><form action={moveAction}><input name="taskId" type="hidden" value={id} /><ContextFields context={context} /><MoveButton disabled={!canMoveDown} label={`下移 ${title}`} value="down"><ChevronDown aria-hidden="true" size={16} /></MoveButton></form></> : null}
    </div> : null}
    {priority ? <span className="task-card__priority" data-priority={priority}>{priority === 1 ? "高" : priority === 2 ? "中" : "低"}</span> : null}
  </article>;
}
