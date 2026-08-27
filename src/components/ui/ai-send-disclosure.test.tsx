import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { AiSendDisclosure } from "./ai-send-disclosure";

afterEach(cleanup);

describe("AiSendDisclosure", () => {
  test("shows the fixed provider and expandable payload details", () => {
    render(<AiSendDisclosure disclosure={{
      provider: "DeepSeek",
      model: "deepseek-v4-flash",
      coreFields: ["已确认发布数据", "系统计算指标"],
      materials: [],
      sources: [{ id: "s1", label: "平台规范", chunkCount: 2 }],
    }} />);

    expect(screen.getByText(/本次将发送给 DeepSeek/)).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("平台规范 · 2 个片段")).toBeInTheDocument();
    expect(screen.getByText(/不会发送 API Key、原始截图或未审核资料/)).toBeInTheDocument();
  });
});
