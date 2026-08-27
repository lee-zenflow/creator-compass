"use client";

import { useMemo, useState } from "react";

import { TASK_SOURCE_ICONS } from "@/features/navigation/module-icons";

type TaskSourceType = keyof typeof TASK_SOURCE_ICONS;

const sourceLabels: Record<TaskSourceType, string> = {
  positioning: "定位报告",
  creation: "创作方案",
  review: "复盘报告",
};

export type TaskPreviewItem = {
  id: string;
  title: string;
  plannedDate: string;
  estimatedMinutes: number;
  priority: 1 | 2 | 3;
  steps: string[];
  completionCriteria: string;
  selected?: boolean;
  sourceType?: TaskSourceType;
};

export function TaskPreview({
  tasks,
  defaultSelectedIds = tasks.filter((task) => task.selected).map((task) => task.id),
  onChange,
}: {
  tasks: TaskPreviewItem[];
  defaultSelectedIds?: string[];
  onChange?: (value: { selectedIds: string[]; orderedIds: string[] }) => void;
}) {
  const [ordered, setOrdered] = useState(tasks);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelectedIds));
  const selectedCount = selected.size;
  const priorityLabel = useMemo(() => ({ 1: "高", 2: "中", 3: "低" }) as const, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange?.({
        selectedIds: ordered.filter((task) => next.has(task.id)).map((task) => task.id),
        orderedIds: ordered.map((task) => task.id),
      });
      return next;
    });
  }

  function move(id: string, direction: -1 | 1) {
    setOrdered((current) => {
      const index = current.findIndex((task) => task.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      onChange?.({
        selectedIds: next.filter((task) => selected.has(task.id)).map((task) => task.id),
        orderedIds: next.map((task) => task.id),
      });
      return next;
    });
  }

  if (ordered.length === 0) {
    return <div className="compact-empty">还没有可写入的任务</div>;
  }

  return (
    <section aria-label="任务预览">
      <div className="compact-section-label">已选 {selectedCount} 项</div>
      <div className="compact-stack">
        {ordered.map((task) => {
          const SourceIcon = task.sourceType ? TASK_SOURCE_ICONS[task.sourceType] : null;
          return (
            <div
            className="task-preview__item"
            data-testid={`task-preview-${task.id}`}
            key={task.id}
            tabIndex={0}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              if (event.key === "ArrowUp") {
                event.preventDefault();
                move(task.id, -1);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                move(task.id, 1);
              }
            }}
          >
            <input
              aria-label={`选择 ${task.title}`}
              checked={selected.has(task.id)}
              onChange={() => toggle(task.id)}
              type="checkbox"
            />
            <div className="task-preview__copy">
              <strong>{task.title}</strong>
              <div className="task-preview__meta">
                {SourceIcon && task.sourceType ? (
                  <span aria-label={`来源：${sourceLabels[task.sourceType]}`} className="record-source">
                    <SourceIcon aria-hidden="true" size={16} strokeWidth={1.8} />
                    {sourceLabels[task.sourceType]}
                  </span>
                ) : null}
                <span>{task.sourceType ? " · " : ""}{task.plannedDate} · {task.estimatedMinutes} 分钟 · {priorityLabel[task.priority]}优先级</span>
              </div>
              <span className="line-clamp-2" data-testid={`task-preview-summary-${task.id}`}>
                步骤：{task.steps.join(" → ")} · 完成标准：{task.completionCriteria}
              </span>
            </div>
            <div className="task-preview__move" aria-label={`调整 ${task.title} 顺序`}>
              <button type="button" aria-label={`上移 ${task.title}`} onClick={() => move(task.id, -1)}>↑</button>
              <button type="button" aria-label={`下移 ${task.title}`} onClick={() => move(task.id, 1)}>↓</button>
            </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
