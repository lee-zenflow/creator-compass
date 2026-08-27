import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { vi } from "vitest";

import { MaterialPicker } from "@/features/materials/material-picker";
import { ReportList } from "@/features/reports/report-list";
import { TaskCard } from "@/features/tasks/task-card";
import { TaskPreview } from "@/features/tasks/task-preview";

const taskCandidates = [
  { id: "a", title: "整理案例", plannedDate: "2026-08-09", estimatedMinutes: 20, priority: 2 as const, steps: ["筛选两个案例"], completionCriteria: "案例进入素材库", sourceType: "creation" as const },
  { id: "b", title: "写出初稿", plannedDate: "2026-08-10", estimatedMinutes: 30, priority: 1 as const, steps: ["列提纲", "写正文"], completionCriteria: "初稿保存完成", sourceType: "creation" as const },
];

test("selects and keyboard-reorders task candidates", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<TaskPreview tasks={taskCandidates} defaultSelectedIds={["a", "b"]} onChange={onChange} />);

  await user.click(screen.getByRole("checkbox", { name: "选择 写出初稿" }));
  expect(screen.getByText("已选 1 项")).toBeInTheDocument();

  const second = screen.getByTestId("task-preview-b");
  fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
  expect(screen.getAllByTestId(/^task-preview-/)[0]).toHaveTextContent("写出初稿");
  expect(onChange).toHaveBeenLastCalledWith({ selectedIds: ["a"], orderedIds: ["b", "a"] });
  expect(screen.getAllByLabelText("来源：创作方案")).toHaveLength(2);
  const summary = screen.getByTestId("task-preview-summary-b");
  expect(summary).toHaveClass("line-clamp-2");
  expect(summary).toHaveTextContent("步骤：列提纲 → 写正文 · 完成标准：初稿保存完成");
});

test("completes and restores a task card", async () => {
  const user = userEvent.setup();
  function ControlledCard() {
    const [completed, setCompleted] = useState(false);
    return <TaskCard title="发布首篇内容" plannedDate="2026-08-10" estimatedMinutes={30} completed={completed} onCompletedChange={setCompleted} />;
  }
  render(<ControlledCard />);
  const checkbox = screen.getByRole("checkbox", { name: "完成 发布首篇内容" });
  await user.click(checkbox);
  expect(checkbox).toBeChecked();
  await user.click(checkbox);
  expect(checkbox).not.toBeChecked();
});

test("selects materials and shows a real empty state", async () => {
  const user = userEvent.setup();
  const onSelectionChange = vi.fn();
  const { rerender } = render(
    <MaterialPicker materials={[{ id: "m1", name: "高互动开头", category: "inspiration" }]} onSelectionChange={onSelectionChange} />,
  );
  await user.click(screen.getByRole("checkbox", { name: "选择 高互动开头" }));
  expect(screen.getByText("已选 1 项素材")).toBeInTheDocument();
  expect(onSelectionChange).toHaveBeenLastCalledWith(["m1"]);

  rerender(<MaterialPicker materials={[]} onSelectionChange={onSelectionChange} />);
  expect(screen.getByText("还没有素材")).toBeInTheDocument();
});

test("exposes URL-restorable report filters and renders the server-filtered records", () => {
  const creation = { id: "r1", href: "/creation/plans/r1", type: "creation" as const, title: "创作方案", summary: "可执行脚本", status: "ready" as const };
  const review = { id: "r2", href: "/reviews/reports/r2", type: "review" as const, title: "复盘报告", summary: "下一轮改进", status: "ready" as const };
  const failed = { id: "r3", href: "/reviews/reports/r3", type: "review" as const, title: "失败报告", summary: null, status: "failed" as const };
  const { rerender } = render(
    <ReportList
      reports={[creation, review, failed]}
    />,
  );
  expect(screen.getByRole("link", { name: "创作" })).toHaveAttribute("href", "/reports?type=creation");
  expect(screen.getByRole("link", { name: "复盘" })).toHaveAttribute("href", "/reports?type=review");

  rerender(<ReportList activeType="creation" reports={[creation]} />);
  expect(screen.getByRole("link", { name: "创作" })).toHaveAttribute("aria-current", "page");
  expect(screen.getAllByText("创作方案").length).toBeGreaterThan(0);
  expect(screen.queryByText("复盘报告")).not.toBeInTheDocument();
});

test("task and report records expose source icons and Chinese status labels", () => {
  const { unmount } = render(
    <TaskCard
      {...{
        title: "确认定位方向",
        plannedDate: "2026-08-11",
        estimatedMinutes: 20,
        completed: true,
        onCompletedChange: () => undefined,
        sourceType: "positioning" as const,
      }}
    />,
  );

  const taskSource = screen.getByLabelText("来源：定位报告");
  expect(taskSource.querySelector("svg")).not.toBeNull();
  expect(screen.getByText("已完成")).toBeInTheDocument();
  unmount();

  render(
    <ReportList
      reports={[
        {
          id: "r-ready",
          href: "/reports?report=r-ready",
          type: "review",
          title: "本轮复盘",
          summary: "保留有效方法",
          status: "ready",
        },
      ]}
    />,
  );

  const reportSource = screen.getByLabelText("类型：复盘报告");
  expect(reportSource.querySelector("svg")).not.toBeNull();
  expect(screen.getByText("已完成")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /本轮复盘/ })).toHaveAttribute(
    "href",
    "/reports?report=r-ready",
  );
});

test("material rows use the shared module icon", () => {
  render(
    <MaterialPicker
      materials={[
        { id: "m-icon", name: "高互动开头", category: "inspiration" },
      ]}
    />,
  );

  expect(screen.getByLabelText("素材：高互动开头")).toHaveAttribute(
    "data-module",
    "materials",
  );
});

test("record pages keep creation compact and profile edits versioned", () => {
  const materialsPage = readFileSync(
    "src/app/(product)/materials/page.tsx",
    "utf8",
  );
  const mePage = readFileSync("src/app/(product)/me/page.tsx", "utf8");
  const profilePage = readFileSync(
    "src/app/(product)/me/profile/page.tsx",
    "utf8",
  );

  expect(materialsPage).toContain('<details className="compact-disclosure"');
  expect(materialsPage).toContain("<summary>新建素材</summary>");
  expect(mePage.match(/<ModuleIcon/g)).toHaveLength(5);
  expect(profilePage).toContain("expectedVersion");
  expect(profilePage).toContain("保存新版本");
});

test("real task pages render stored source types and Chinese states", () => {
  const taskListPage = readFileSync(
    "src/app/(product)/tasks/page.tsx",
    "utf8",
  );
  const taskDetailPage = readFileSync(
    "src/app/(product)/tasks/[id]/page.tsx",
    "utf8",
  );

  expect(taskListPage).toContain("<TaskList");
  expect(taskListPage).toContain("task.sourceSnapshot.report.type");
  expect(taskListPage).toContain("status: task.status");
  expect(taskListPage).toContain("taskSourceHref({");

  expect(taskDetailPage).toContain("TASK_SOURCE_ICONS");
  expect(taskDetailPage).toContain("task.sourceSnapshot.report.type");
  expect(taskDetailPage).toContain("TASK_STATUS_LABELS[task.status]");
  expect(taskDetailPage).toContain("来源：");
  expect(taskDetailPage).toContain("taskSourceHref({");
  expect(taskDetailPage).toContain("entityId: task.sourceSnapshot.typedVersion.entityId ?? null");
});
