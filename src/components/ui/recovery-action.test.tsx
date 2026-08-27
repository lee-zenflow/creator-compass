import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

import { RecoveryAction } from "./recovery-action";

describe("RecoveryAction", () => {
  test("offers one compact retry without exposing internal details", () => {
    render(
      <RecoveryAction
        code="TIMEOUT"
        retryAction={vi.fn()}
        retryFields={{ failedRunId: "run-1" }}
        returnHref="/creation/project-1"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("已保留上次输入");
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("run-1")).toHaveAttribute(
      "name",
      "failedRunId",
    );
  });

  test("returns to editing when the latest input must be used", () => {
    render(
      <RecoveryAction
        code="AI_INPUT_CHANGED"
        returnHref="/positioning/session-1"
      />,
    );

    expect(
      screen.getByRole("link", { name: "使用最新内容重新生成" }),
    ).toHaveAttribute("href", "/positioning/session-1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("uses a safe generic state for unknown errors", () => {
    render(
      <RecoveryAction
        code="deepseek raw upstream error"
        retryAction={vi.fn()}
        returnHref="/reviews/review-1"
      />,
    );

    expect(screen.getByText("生成未完成")).toBeInTheDocument();
    expect(screen.queryByText(/deepseek|upstream/i)).not.toBeInTheDocument();
  });

  test("keeps recovery as a compact mobile row instead of a large card", () => {
    const styles = readFileSync("src/app/globals.css", "utf8");

    expect(styles).toMatch(/\.recovery-action\s*\{[^}]*display:\s*grid/);
    expect(styles).toMatch(/\.recovery-action\s*\{[^}]*min-height:\s*68px/);
    expect(styles).toMatch(/\.recovery-action\s*\{[^}]*border-block:/);
  });
});
