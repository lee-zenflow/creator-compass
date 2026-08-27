import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { CompactEmptyState } from "./compact-empty-state";

describe("CompactEmptyState", () => {
  test("shows one icon, one explanation and at most one action", () => {
    render(<CompactEmptyState
      action={{ href: "/tools", label: "去工具箱" }}
      detail="确认方案后会生成行动任务"
      icon="tasks"
      title="还没有任务"
    />);

    expect(screen.getByLabelText("还没有任务")).toBeInTheDocument();
    expect(screen.getByText("确认方案后会生成行动任务")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去工具箱" })).toHaveAttribute("href", "/tools");
  });

  test("stays a compact row rather than a large placeholder card", () => {
    const styles = readFileSync("src/app/globals.css", "utf8");
    expect(styles).toMatch(/\.compact-empty-state\s*\{[^}]*min-height:\s*64px/);
    expect(styles).toMatch(/\.compact-empty-state\s*\{[^}]*grid-template-columns:/);
  });
});
