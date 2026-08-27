import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { CurrentStepRow } from "./current-step-row";

describe("CurrentStepRow", () => {
  test("renders one labelled primary action for the real stage", () => {
    render(<CurrentStepRow action={{
      stage: "task",
      title: "完成脚本",
      detail: "执行当前最高优先级任务",
      href: "/tasks/task-1",
      actionLabel: "查看任务",
    }} />);

    expect(screen.getByTestId("current-step")).toHaveAttribute("data-stage", "task");
    expect(screen.getByLabelText("完成脚本")).toHaveAttribute("data-module", "tasks");
    expect(screen.getByRole("link", { name: "查看任务" })).toHaveAttribute("href", "/tasks/task-1");
    expect(screen.getByRole("link", { name: "查看任务" })).toHaveAttribute("data-variant", "primary");
  });

  test("uses the module icon that matches each journey stage", () => {
    const { rerender } = render(<CurrentStepRow action={{
      stage: "creation",
      title: "开始创作",
      detail: "使用已确认定位",
      href: "/creation/new",
      actionLabel: "开始创作",
    }} />);
    expect(screen.getByLabelText("开始创作")).toHaveAttribute("data-module", "creation");

    rerender(<CurrentStepRow action={{
      stage: "review",
      title: "开始复盘",
      detail: "补充真实数据",
      href: "/reviews/new",
      actionLabel: "开始复盘",
    }} />);
    expect(screen.getByLabelText("开始复盘")).toHaveAttribute("data-module", "review");
  });
});
