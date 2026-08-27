import { describe, expect, test } from "vitest";

import { AI_OUTPUT_SCHEMAS } from "./ai-schemas";
import {
  deterministicAiOutput,
  isTestAiAdapterEnabled,
} from "./test-ai-adapter";

const messageId = "11111111-1111-4111-8111-111111111111";

describe("deterministic test AI adapter", () => {
  test("is available outside production and only in an explicit loopback production runtime", () => {
    expect(isTestAiAdapterEnabled({ AI_ADAPTER: "test", NODE_ENV: "test" })).toBe(true);
    expect(isTestAiAdapterEnabled({ AI_ADAPTER: "test", NODE_ENV: "production" })).toBe(false);
    expect(isTestAiAdapterEnabled({ AI_ADAPTER: "test", NODE_ENV: "production", LOCAL_RUNTIME_MODE: "1", APP_URL: "https://creator.example" })).toBe(false);
    expect(isTestAiAdapterEnabled({ AI_ADAPTER: "test", NODE_ENV: "production", LOCAL_RUNTIME_MODE: "1", APP_URL: "http://127.0.0.1:3000" })).toBe(true);
    expect(isTestAiAdapterEnabled({ AI_ADAPTER: "deepseek", NODE_ENV: "test" })).toBe(false);
  });

  test("returns schema-valid outputs for every AI task without invented citations", () => {
    const subjectData = {
      session: { completeness: 0, currentStep: 1, draft: {} },
      messages: [{ id: messageId, sender: "user", content: "我想分享自己的产品学习过程。" }],
      project: { contentType: "article", platform: "小红书", goal: "整理学习复盘" },
      review: { platform: "小红书", contentTitle: "产品学习复盘" },
      confirmedSnapshot: { confirmedMetrics: { views: 100, likes: 8 } },
    };

    for (const taskType of Object.keys(AI_OUTPUT_SCHEMAS) as Array<keyof typeof AI_OUTPUT_SCHEMAS>) {
      const output = deterministicAiOutput(taskType, subjectData, []);
      expect(AI_OUTPUT_SCHEMAS[taskType].safeParse(output).success, taskType).toBe(true);
    }
    expect(deterministicAiOutput("positioning_report", subjectData, []).candidates
      .every((candidate) => candidate.citations.length === 0)).toBe(true);
    expect(deterministicAiOutput("content_plan", subjectData, []).citations).toEqual([]);
    expect(deterministicAiOutput("review_report", subjectData, []).citations).toEqual([]);
  });
});
