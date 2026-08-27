import { describe, expect, test } from "vitest";

import { recoveryFor } from "./recovery-contract";

describe("recoveryFor", () => {
  test.each([
    ["NOT_CONFIGURED", "AI 暂未配置", "返回修改", false],
    ["TIMEOUT", "生成超时", "重新生成", true],
    ["RATE_LIMITED", "当前请求较多", "重新生成", true],
    ["INVALID_OUTPUT", "生成结果未通过校验", "重新生成", true],
    ["UPSTREAM_ERROR", "AI 服务暂时不可用", "重新生成", true],
    ["QUEUE_UNAVAILABLE", "生成任务暂未开始", "重新生成", true],
    ["AI_INPUT_CHANGED", "输入内容已更新", "使用最新内容重新生成", false],
  ] as const)("maps %s to one safe recovery state", (code, title, action, retryable) => {
    expect(recoveryFor(code)).toMatchObject({ code, title, action, retryable });
  });

  test("never exposes an unknown internal error", () => {
    const recovery = recoveryFor("postgres connection stack trace");

    expect(recovery).toEqual({
      code: "UNKNOWN",
      title: "生成未完成",
      detail: "上次输入已保留，可以稍后重试。",
      action: "重新生成",
      retryable: true,
    });
    expect(JSON.stringify(recovery)).not.toMatch(/postgres|stack/i);
  });

  test("recognizes an input revision conflict from the safe detail only", () => {
    expect(recoveryFor("INVALID_OUTPUT", "AI_INPUT_CHANGED")).toMatchObject({
      code: "AI_INPUT_CHANGED",
      retryable: false,
    });
  });
});
