import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { MetricSparkline } from "./metric-sparkline";
import { ModuleIcon } from "./module-icon";
import { StatusRow } from "./status-row";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("mobile visual primitives", () => {
  test("module icon keeps a labelled 32px visual base", () => {
    render(<ModuleIcon name="positioning" label="IP 定位" />);

    expect(screen.getByLabelText("IP 定位")).toHaveAttribute(
      "data-module",
      "positioning",
    );
  });

  test("module icons use their business tone instead of generic color names", () => {
    render(<>
      <ModuleIcon name="positioning" label="定位" />
      <ModuleIcon name="creation" label="创作" />
      <ModuleIcon name="review" label="复盘" />
      <ModuleIcon name="tasks" label="任务" />
    </>);

    expect(screen.getByLabelText("定位")).toHaveAttribute("data-tone", "positioning");
    expect(screen.getByLabelText("创作")).toHaveAttribute("data-tone", "creation");
    expect(screen.getByLabelText("复盘")).toHaveAttribute("data-tone", "review");
    expect(screen.getByLabelText("任务")).toHaveAttribute("data-tone", "task");
  });

  test("sparkline exposes its real data summary", () => {
    render(<MetricSparkline label="播放趋势" points={[12, 18, 16]} />);

    expect(
      screen.getByRole("img", { name: "播放趋势：12、18、16" }),
    ).toBeInTheDocument();
  });

  test("error status exposes an alert with optional detail", () => {
    render(
      <StatusRow state="error" title="生成失败" detail="请保留原输入后重试" />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute("data-state", "error");
    expect(screen.getByText("请保留原输入后重试")).toBeInTheDocument();
  });

  test("keeps the compact teal visual tokens and two-line utility", () => {
    expect(styles).toContain("--cc-bg: #f4f7f6");
    expect(styles).toContain("--cc-accent: #397e83");
    expect(styles).toMatch(
      /\.module-icon\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/,
    );
    expect(styles).toContain("--cc-positioning: #397e83");
    expect(styles).toContain("--cc-creation: #4d7292");
    expect(styles).toContain("--cc-review: #8a6a26");
    expect(styles).toMatch(
      /\.line-clamp-2\s*\{[^}]*-webkit-line-clamp:\s*2/,
    );
    expect(styles).toMatch(/\.status-row\s*\{[^}]*display:\s*flex/);
  });

  test("locks compact primitive dimensions in the real stylesheet", () => {
    expect(styles).toContain("width: min(100%, 390px)");
    expect(styles).toMatch(/\.compact-button\s*\{[^}]*height:\s*42px/);
    expect(styles).toMatch(/\.candidate-card\s*\{[^}]*height:\s*148px/);
    expect(styles).toMatch(/\.positioning-task-card\s*\{[^}]*height:\s*84px/);
  });
});
