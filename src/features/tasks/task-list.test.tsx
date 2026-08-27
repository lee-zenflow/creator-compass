import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskList, updateTaskSelection, type TaskListItem } from "./task-list";

const baseTask: TaskListItem = { id: "20000000-0000-4000-8000-000000000002", title: "补充素材", plannedDate: "2026-08-20", today: "2026-08-20", estimatedMinutes: 30, status: "pending", completionCriteria: "保存三条参考素材", priority: 1, sourceType: "creation", sourceHref: "/creation/project/materials" };
const actions = { startAction: vi.fn(), completeAction: vi.fn(), restoreAction: vi.fn(), batchAction: vi.fn(), moveAction: vi.fn(), range: "today" as const, status: "pending" as const };

describe("TaskList selection and ordering", () => {
  test("keeps batch controls hidden until selection mode contains a task", async () => {
    const user = userEvent.setup(); render(<TaskList {...actions} tasks={[baseTask]} />);
    expect(screen.queryByRole("button", { name: "完成所选任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "选择 补充素材" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择任务" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 补充素材" }));
    expect(screen.getByRole("button", { name: "完成所选任务" })).toBeInTheDocument();
    expect(document.querySelectorAll('input[name="taskIds"]')).toHaveLength(1);
    expect(document.querySelector('input[name="range"]')).toHaveValue("today");
    expect(document.querySelector('input[name="status"]')).toHaveValue("pending");
  });

  test("caps a batch selection at 50 tasks", () => {
    let selected: string[] = [];
    for (let index = 0; index < 51; index += 1) selected = updateTaskSelection(selected, `task-${index}`, true);
    expect(selected).toHaveLength(50); expect(selected).not.toContain("task-50");
  });

  test("separates reorder mode so five controls never squeeze the task copy", async () => {
    const user = userEvent.setup();
    render(<TaskList {...actions} status="all" tasks={[baseTask, { ...baseTask, id: "20000000-0000-4000-8000-000000000003", title: "写初稿" }, { ...baseTask, id: "20000000-0000-4000-8000-000000000004", title: "明日任务", plannedDate: "2026-08-21" }]} />);
    expect(screen.queryByRole("button", { name: "上移 补充素材" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    expect(screen.queryByRole("button", { name: "开始 补充素材" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上移 补充素材" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 补充素材" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上移 写初稿" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移 写初稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移 明日任务" })).toBeDisabled();
  });

  test("hides reorder mode under a status filter", () => {
    render(<TaskList {...actions} status="completed" tasks={[{ ...baseTask, status: "completed" }]} />);
    expect(screen.queryByRole("button", { name: "调整顺序" })).not.toBeInTheDocument();
  });

  test("excludes dismissed tasks from reorder adjacency", async () => {
    const user = userEvent.setup();
    render(<TaskList {...actions} status="all" tasks={[baseTask, { ...baseTask, id: "20000000-0000-4000-8000-000000000003", title: "已取消任务", status: "dismissed" }, { ...baseTask, id: "20000000-0000-4000-8000-000000000004", title: "写初稿" }]} />);
    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    expect(screen.queryByRole("button", { name: /已取消任务/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下移 补充素材" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上移 写初稿" })).toBeEnabled();
  });
});
