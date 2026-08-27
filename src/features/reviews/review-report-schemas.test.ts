import { describe, expect, test } from "vitest";

import {
  assertReviewCitationsAllowed,
  normalizeReviewReportOutput,
  reviewReportRawOutputSchema,
} from "./review-report-schemas";

const raw = {
  dataSummary: { 互动率: "6%" },
  retained: ["保留开头直接提出问题"],
  problems: ["收藏率偏低"],
  causes: ["清单信息不够具体"],
  actions: [{
    title: "补充一条清单型内容", reason: "验证收藏意愿", steps: ["整理 3 条清单", "发布"],
    completionCriteria: "完成发布并记录 24 小时数据", estimatedMinutes: 45, priority: 1 as const,
  }],
  citations: [{ itemId: "30000000-0000-4000-8000-000000000003", sourceId: "40000000-0000-4000-8000-000000000004" }],
};

describe("review report schema", () => {
  test("keeps model output free of server-owned ids and dates", () => {
    expect(reviewReportRawOutputSchema.parse(raw).actions[0]).not.toHaveProperty("id");
    expect(reviewReportRawOutputSchema.safeParse({ ...raw, actions: [{ ...raw.actions[0], plannedDate: "2099-01-01" }] }).success).toBe(false);
  });

  test("normalizes actions with stable server-owned ids and dates", () => {
    const first = normalizeReviewReportOutput(raw, "10000000-0000-4000-8000-000000000001", new Date("2026-08-09T00:00:00+08:00"));
    const second = normalizeReviewReportOutput(raw, "10000000-0000-4000-8000-000000000001", new Date("2026-08-09T00:00:00+08:00"));
    expect(first.actions[0]).toEqual(expect.objectContaining({ id: second.actions[0]!.id, plannedDate: "2026-08-10" }));
  });

  test("rejects citations absent from this retrieval record", () => {
    const allowed = [{ itemId: "30000000-0000-4000-8000-000000000003", sourceId: "40000000-0000-4000-8000-000000000004" }];
    expect(() => assertReviewCitationsAllowed(raw, [{ ...allowed[0]!, itemId: "50000000-0000-4000-8000-000000000005" }])).toThrow("INVALID_CITATION");
    expect(() => assertReviewCitationsAllowed(raw, allowed)).not.toThrow();
  });

  test("rejects source-only and malformed citations for new AI output", () => {
    expect(reviewReportRawOutputSchema.safeParse({ ...raw, sourceIds: ["40000000-0000-4000-8000-000000000004"], citations: undefined }).success).toBe(false);
    expect(reviewReportRawOutputSchema.safeParse({ ...raw, citations: [{ itemId: "bad", sourceId: "bad" }] }).success).toBe(false);
  });
});
