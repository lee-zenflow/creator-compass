import { describe, expect, test, vi } from "vitest";

import type { CreatorCompassDatabase } from "@/server/db/client";
import type { WorkerAiRun } from "@/workers/ai-worker";
import { createReviewAiTaskHandlers } from "./review-ai-processor";

const run: WorkerAiRun = {
  id: "10000000-0000-4000-8000-000000000001",
  taskType: "review_report",
  status: "processing",
  createdAt: new Date("2026-08-09T00:00:00+08:00"),
};
const raw = {
  dataSummary: { 互动率: "6%" }, retained: ["保留开头"], problems: ["收藏偏低"], causes: ["清单不具体"],
  actions: [{ title: "补充清单", reason: "验证收藏", steps: ["整理清单"], completionCriteria: "发布并记录数据", estimatedMinutes: 30, priority: 1 as const }],
  citations: [],
};

describe("review AI processor", () => {
  test("normalizes actions before transactional persistence", async () => {
    const persist = vi.fn(async () => undefined);
    const handlers = createReviewAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "review_report" as const, output: raw })),
      persistReviewReport: persist,
      releaseReview: vi.fn(async () => undefined),
    });
    const finalization = await handlers.review_report.process(run, new AbortController().signal);
    await finalization.persist({} as CreatorCompassDatabase);
    expect(persist).toHaveBeenCalledWith(expect.anything(), run, expect.objectContaining({
      actions: [expect.objectContaining({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), plannedDate: "2026-08-10" })],
    }));
  });

  test("releases the review after terminal failure", async () => {
    const release = vi.fn(async () => undefined);
    const handlers = createReviewAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "review_report" as const, output: raw })),
      persistReviewReport: vi.fn(async () => undefined),
      releaseReview: release,
    });
    const finalization = await handlers.review_report.onTerminalFailure!(run);
    await finalization.persist({} as CreatorCompassDatabase);
    expect(release).toHaveBeenCalledWith(expect.anything(), run);
  });
});
