import { describe, expect, test, vi } from "vitest";

import type { CreatorCompassDatabase } from "@/server/db/client";
import type { WorkerAiRun } from "@/workers/ai-worker";
import { createCreationAiTaskHandlers } from "./creation-ai-processor";

const run: WorkerAiRun = {
  id: "10000000-0000-4000-8000-000000000001",
  taskType: "content_plan",
  status: "processing",
  createdAt: new Date("2026-08-09T00:00:00+08:00"),
};

const raw = {
  contentType: "video" as const,
  hooks: ["先给结果"], storyboard: ["镜头一"], voiceover: "完整口播",
  shootingSteps: ["准备拍摄"], riskNotes: [], citations: [],
  tasks: [{ title: "拍摄", reason: "验证", steps: ["拍摄"], completionCriteria: "导出成片", estimatedMinutes: 30, priority: 1 as const }],
};

describe("creation AI processor", () => {
  test("normalizes model output before transactional persistence", async () => {
    const persist = vi.fn(async () => undefined);
    const handlers = createCreationAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "content_plan" as const, output: raw })),
      persistContentPlan: persist,
      releaseCreationProject: vi.fn(async () => undefined),
    });
    const finalization = await handlers.content_plan.process(run, new AbortController().signal);
    await finalization.persist({} as CreatorCompassDatabase);
    expect(persist).toHaveBeenCalledWith(expect.anything(), run, expect.objectContaining({
      contentType: "video",
      tasks: [expect.objectContaining({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), plannedDate: "2026-08-09" })],
    }));
  });

  test("releases the project after a terminal generation failure", async () => {
    const release = vi.fn(async () => undefined);
    const handlers = createCreationAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "content_plan" as const, output: raw })),
      persistContentPlan: vi.fn(async () => undefined),
      releaseCreationProject: release,
    });
    const finalization = await handlers.content_plan.onTerminalFailure!(run);
    await finalization.persist({} as CreatorCompassDatabase);
    expect(release).toHaveBeenCalledWith(expect.anything(), run);
  });
});
