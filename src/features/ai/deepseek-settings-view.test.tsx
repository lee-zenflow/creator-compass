import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DeepSeekSettingsView } from "./deepseek-settings-view";

afterEach(cleanup);

describe("DeepSeek settings view", () => {
  test("shows consent and key testing for an unconfigured Owner", () => {
    render(
      <DeepSeekSettingsView
        status={{ configured: false, monthlyUsage: { inputTokens: 0, outputTokens: 0 }, recentUsage: [] }}
        saveAction={vi.fn()}
        revokeAction={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("DeepSeek API Key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("checkbox", { name: /我确认本次会把明确列出的内容发送给 DeepSeek/ })).toBeRequired();
    expect(screen.getByRole("button", { name: "测试并保存" })).toBeInTheDocument();
  });

  test("shows only last four and monthly token totals for a configured Owner", () => {
    render(
      <DeepSeekSettingsView
        status={{
          configured: true,
          lastFour: "aa75",
          testedAt: new Date("2026-08-24T12:00:00Z"),
          monthlyUsage: { inputTokens: 1200, outputTokens: 345 },
          recentUsage: [{
            runId: "50000000-0000-4000-8000-000000000001",
            taskType: "content_plan",
            inputTokens: 210,
            outputTokens: 88,
            createdAt: new Date("2026-08-24T12:30:00Z"),
          }],
        }}
        saveAction={vi.fn()}
        revokeAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/末四位 aa75/)).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("345")).toBeInTheDocument();
    expect(screen.getByText("事前创作")).toBeInTheDocument();
    expect(screen.getByText("输入 210 · 输出 88")).toBeInTheDocument();
    expect(screen.queryByText(/sk-/)).toBeNull();
    expect(screen.getByRole("button", { name: "撤销并销毁 Key" })).toBeInTheDocument();
  });
});
