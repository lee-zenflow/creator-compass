import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import type { WorkspaceViewModel } from "./workspace-service";
import { WorkspaceView } from "./workspace-view";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

const activeWorkspaceFixture: WorkspaceViewModel = {
  kind: "activeUser",
  range: 7,
  accounts: [{ id: "account-1", platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true }],
  activeAccount: { id: "account-1", platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true },
  metrics: { views: 1_200, interactionRate: 0.06, followerConversionRate: 0.01 },
  historicalConclusion: null,
  dataRequirement: null,
  trend: [{ date: "2026-08-08", views: 1_000 }, { date: "2026-08-09", views: 1_200 }],
  insight: { reportId: "report-1", reviewId: "review-1", version: 1, problem: "标题表达不够具体", action: "下一条改用结果型标题" },
  upcomingTasks: [
    { id: "task-1", title: "整理真实案例", plannedDate: "2026-08-10", status: "pending", completed: false, daysFromToday: 1 },
    { id: "task-2", title: "完成内容初稿", plannedDate: "2026-08-11", status: "in_progress", completed: false, daysFromToday: 2 },
    { id: "task-3", title: "安排第三项任务", plannedDate: "2026-08-12", status: "pending", completed: false, daysFromToday: 3 },
  ],
  recentReports: [{ id: "report-2", type: "review", title: "产品学习复盘", summary: "查看本轮结论", createdAt: new Date("2026-08-09T08:00:00+08:00") }],
  nextAction: { stage: "task", title: "整理真实案例", detail: "执行当前最高优先级任务", href: "/tasks/task-1", actionLabel: "查看任务" },
};

describe("workspace view", () => {
  test("new users see one primary journey action and a quieter account action", () => {
    render(<WorkspaceView view={{
      kind: "newUser",
      range: 7,
      accounts: [],
      nextAction: { stage: "profile", title: "完善创作档案", detail: "先补齐你的创作条件", href: "/me/profile", actionLabel: "去完善" },
    }} />);

    expect(screen.getByTestId("current-step")).toHaveAttribute("data-stage", "profile");
    expect(screen.getByRole("link", { name: "去完善" })).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("link", { name: "添加账号标签" })).toHaveAttribute("data-variant", "text");
    expect(screen.getAllByRole("link").filter((item) => item.getAttribute("data-variant") === "primary")).toHaveLength(1);
    expect(screen.queryByText(/0%|预计|模拟数据/)).not.toBeInTheDocument();
  });

  test("active workspace keeps real metrics compact", () => {
    render(<WorkspaceView view={activeWorkspaceFixture} />);

    expect(screen.getByTestId("current-step")).toHaveClass("instrument-action");
    expect(screen.getByTestId("current-step").querySelector(".instrument-action__coordinate")).toHaveTextContent("NEXT ACTION");
    expect(screen.getByRole("link", { name: /主账号/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "播放趋势：1000、1200" })).toBeInTheDocument();
    expect(screen.getAllByTestId("workspace-metric")).toHaveLength(3);
    expect(screen.getByText("接下来")).toBeInTheDocument();
    expect(screen.getByTestId("current-step")).toHaveAttribute("data-stage", "task");
    expect(screen.getAllByTestId("workspace-task")).toHaveLength(2);
    expect(screen.queryByText("安排第三项任务")).not.toBeInTheDocument();
    expect(screen.queryByText(/模拟|预计完成/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").filter((item) => item.getAttribute("data-variant") === "primary")).toHaveLength(1);
  });

  test("wires the real workspace coordinate into the product shell", () => {
    const page = readFileSync(resolve("src/app/(product)/workspace/page.tsx"), "utf8");

    expect(page).toContain('coordinate="TODAY · POSITION"');
  });

  test("keeps the instrument treatment dark, compact and module-specific", () => {
    expect(styles).toMatch(/\.instrument-action\s*\{[^}]*background-color:\s*var\(--cc-ink-deep\)/);
    expect(styles).toMatch(/\.instrument-action__coordinate\s*\{[^}]*font-size:\s*8px/);
    expect(styles).toMatch(/\.tool-row\[data-module\]::before\s*\{[^}]*width:\s*2px/);
    expect(styles).toMatch(/\.current-step-row\s*\{[^}]*min-height:\s*68px/);
    expect(styles).toMatch(/\.tool-row\s*\{[^}]*min-height:\s*64px/);
  });
});
