import { describe, expect, test } from "vitest";

import {
  contentPlanOutputSchemas,
  normalizeContentPlanOutput,
  type ContentPlanRawOutput,
} from "./creation-schemas";

describe("content plan schemas", () => {
  test.each([
    ["article", ["titleSuggestions", "outline", "body", "imageSuggestions", "riskNotes"]],
    ["video", ["hooks", "storyboard", "voiceover", "shootingSteps", "riskNotes"]],
    ["copy", ["titleSuggestions", "body", "publishingGuide", "riskNotes"]],
  ] as const)("validates %s output", (type, fields) => {
    expect(Object.keys(contentPlanOutputSchemas[type].shape)).toEqual(expect.arrayContaining([...fields]));
  });

  test("creates stable task ids and server-owned dates", () => {
    const raw: ContentPlanRawOutput = {
      contentType: "video",
      hooks: ["三秒说明问题"],
      storyboard: ["镜头一"],
      voiceover: "完整口播稿",
      shootingSteps: ["准备桌面"],
      riskNotes: [],
      tasks: [{
        title: "拍摄首版",
        reason: "验证表达",
        steps: ["完成拍摄"],
        estimatedMinutes: 30,
        priority: 1,
        completionCriteria: "导出一条可预览视频",
      }],
      citations: [],
    };
    const first = normalizeContentPlanOutput(raw, "10000000-0000-4000-8000-000000000001", new Date("2026-08-09T00:00:00+08:00"));
    const retry = normalizeContentPlanOutput(raw, "10000000-0000-4000-8000-000000000001", new Date("2026-08-09T00:00:00+08:00"));
    expect(retry).toEqual(first);
    expect(first.tasks[0]).toMatchObject({ plannedDate: "2026-08-09", priority: 1 });
    expect(first.tasks[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects fields from a different content type", () => {
    expect(() => contentPlanOutputSchemas.article.parse({
      contentType: "article",
      titleSuggestions: ["标题"], outline: ["结构"], body: "正文",
      imageSuggestions: [], riskNotes: [], tasks: [], citations: [], hooks: ["不允许"],
    })).toThrow();
  });
});
