import { describe, expect, test } from "vitest";

import { AI_OUTPUT_SCHEMAS } from "./ai-schemas";

describe("AI output contracts", () => {
  test("accepts the raw positioning shape without model-controlled IDs", () => {
    const task = {
      title: "验证选题",
      reason: "验证方向",
      steps: ["发布"],
      completionCriteria: "完成一次发布",
      estimatedMinutes: 30,
      priority: 1,
    };
    const candidate = {
      name: "方向",
      audience: "个人创作者",
      direction: "AI 工作流",
      contentPillars: ["定位", "创作", "复盘"],
      matchExplanation: "匹配访谈",
      risks: [],
      citations: [],
      initialTasks: [task, task, task],
    };
    const raw = { candidates: [candidate, candidate, candidate] };
    expect(AI_OUTPUT_SCHEMAS.positioning_report.safeParse(raw).success).toBe(true);
    expect(AI_OUTPUT_SCHEMAS.positioning_report.safeParse({
      candidates: raw.candidates.map((item) => ({ ...item, id: crypto.randomUUID() })),
    }).success).toBe(false);
  });
  test("keeps every task output strict and bounded", () => {
    for (const schema of Object.values(AI_OUTPUT_SCHEMAS)) {
      expect(() => schema.parse({ unexpected: "field" })).toThrow();
    }
  });

  test("content generation uses the requested typed raw shape", () => {
    expect(AI_OUTPUT_SCHEMAS.content_plan.safeParse({
      contentType: "copy", titleSuggestions: ["标题"], body: "正文",
      publishingGuide: ["发布建议"], riskNotes: [], tasks: [{
        title: "发布", reason: "验证", steps: ["发布"], completionCriteria: "已发布",
        estimatedMinutes: 15, priority: 1,
      }], citations: [],
    }).success).toBe(true);
  });
});
