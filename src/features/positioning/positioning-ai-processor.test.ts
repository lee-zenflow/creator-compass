import { describe, expect, test, vi } from "vitest";

import type { AiGeneratedResult } from "@/server/ai/execute-ai-task";
import type { CreatorCompassDatabase } from "@/server/db/client";
import type { WorkerAiRun } from "@/workers/ai-worker";
import {
  assertProfileEvidenceAllowed,
  createPositioningAiTaskHandlers,
  normalizePositioningReportIds,
  nextInterviewQuestion,
  milestonePromptText,
} from "./positioning-ai-processor";
import type { PositioningReportOutput, PositioningReportRawOutput, ProfileExtractOutput } from "./positioning-schemas";

const run: WorkerAiRun = {
  id: "20000000-0000-4000-8000-000000000001",
  taskType: "profile_extract",
  status: "processing",
};

const profileOutput: ProfileExtractOutput = {
  profileDimensions: {
    interestsExperience: { score: 100, value: "A", evidenceMessageIds: ["30000000-0000-4000-8000-000000000001"] },
    skills: { score: 100, value: "B", evidenceMessageIds: [] },
    resources: { score: 100, value: "C", evidenceMessageIds: [] },
    availableTime: { score: 100, value: "D", evidenceMessageIds: [] },
    creationGoal: { score: 100, value: "E", evidenceMessageIds: [] },
    platformPreference: { score: 100, value: "F", evidenceMessageIds: [] },
    sustainableSources: { score: 50, value: "G", evidenceMessageIds: [] },
    constraints: { score: 0, value: "", evidenceMessageIds: [] },
  },
  nextQuestion: "下一步你想优先验证哪个方向？",
};

const reportOutput: PositioningReportRawOutput = {
  candidates: ["a", "b", "c"].map((suffix) => ({
    name: `候选${suffix}`,
    audience: "个人创作者",
    direction: "AI 工作流",
    contentPillars: ["定位", "创作", "复盘"],
    matchExplanation: "与访谈证据匹配",
    risks: [],
    citations: [{ itemId: "item-1", sourceId: "source-1" }],
    initialTasks: [1, 2, 3].map((index) => ({
      title: `任务${index}`,
      reason: "验证方向",
      steps: ["执行"],
      completionCriteria: "完成并记录结果",
      estimatedMinutes: 30,
      priority: index === 1 ? 1 as const : 2 as const,
    })),
  })),
};

describe("positioning AI processor", () => {
  test("never persists an eleventh AI-led core question", () => {
    expect(nextInterviewQuestion(9, 88, "第十个问题")).toBe("第十个问题");
    expect(nextInterviewQuestion(9, 100, "画像已完整后的问题")).toBeNull();
    expect(nextInterviewQuestion(10, 88, "第十一个问题")).toBeNull();
    expect(nextInterviewQuestion(10, 88, null)).toBeNull();
    expect(milestonePromptText("eighty")).toContain("80%");
    expect(milestonePromptText("complete")).toContain("完整");
  });
  test("rejects evidence IDs outside the current session user-message allowlist", () => {
    expect(() =>
      assertProfileEvidenceAllowed(profileOutput, new Set(["30000000-0000-4000-8000-000000000099"])),
    ).toThrow("INVALID_EVIDENCE_MESSAGE");
    expect(() =>
      assertProfileEvidenceAllowed(profileOutput, new Set(["30000000-0000-4000-8000-000000000001"])),
    ).not.toThrow();
  });

  test("validates exact item/source pairs and replaces model-provided candidate and task IDs", () => {
    const aiRunId = "20000000-0000-4000-8000-000000000001";
    const normalized = normalizePositioningReportIds(
      reportOutput,
      [{ itemId: "item-1", sourceId: "source-1" }],
      aiRunId,
    );
    expect(normalized).toEqual(normalizePositioningReportIds(
      reportOutput,
      [{ itemId: "item-1", sourceId: "source-1" }],
      aiRunId,
    ));
    expect(normalized.candidates.every((candidate) => /^[0-9a-f-]{36}$/.test(candidate.id))).toBe(true);
    expect(normalized.candidates.flatMap((candidate) => candidate.initialTasks).every((task) => /^[0-9a-f-]{36}$/.test(task.id))).toBe(true);
    let citationFailure: unknown;
    try {
      normalizePositioningReportIds(
        reportOutput,
        [{ itemId: "other-item", sourceId: "source-1" }],
        aiRunId,
      );
    } catch (error) {
      citationFailure = error;
    }
    expect(citationFailure).toMatchObject({
      code: "INVALID_OUTPUT",
      message: "INVALID_CITATION",
      retryable: false,
    });
  });

  test("persists a task-matched generated result through the worker finalization transaction", async () => {
    const transaction = { kind: "worker-finalize-transaction" } as unknown as CreatorCompassDatabase;
    const persistProfileExtract = vi.fn(async () => undefined);
    const handlers = createPositioningAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "profile_extract", output: profileOutput }) as AiGeneratedResult),
      persistProfileExtract,
      persistPositioningReport: vi.fn(async () => undefined),
      releasePositioningSession: vi.fn(async () => undefined),
    });
    const finalization = await handlers.profile_extract!.process(run, new AbortController().signal);
    await finalization.persist(transaction);
    expect(persistProfileExtract).toHaveBeenCalledWith(transaction, run, profileOutput);
  });

  test("rejects a generated result whose task type does not match the queued run", async () => {
    const handlers = createPositioningAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "positioning_report", output: reportOutput }) as AiGeneratedResult),
      persistProfileExtract: vi.fn(async () => undefined),
      persistPositioningReport: vi.fn(async () => undefined),
      releasePositioningSession: vi.fn(async () => undefined),
    });
    await expect(
      handlers.profile_extract!.process(run, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
  });

  test("normalizes raw report IDs before handing the result to persistence", async () => {
    const persistPositioningReport = vi.fn<(
      transaction: CreatorCompassDatabase,
      run: WorkerAiRun,
      output: PositioningReportOutput,
    ) => Promise<void>>(async () => undefined);
    const handlers = createPositioningAiTaskHandlers({
      generate: vi.fn(async () => ({ taskType: "positioning_report", output: reportOutput }) as AiGeneratedResult),
      persistProfileExtract: vi.fn(async () => undefined),
      persistPositioningReport,
      releasePositioningSession: vi.fn(async () => undefined),
    });
    const reportRun = { ...run, taskType: "positioning_report" as const };
    const finalization = await handlers.positioning_report!.process(reportRun, new AbortController().signal);
    await finalization.persist({} as CreatorCompassDatabase);
    const persisted = persistPositioningReport.mock.calls[0]![2];
    expect(persisted.candidates.every((candidate) => /^[0-9a-f-]{36}$/.test(candidate.id))).toBe(true);
  });

  test("builds an atomic terminal-failure release finalization for the same run", async () => {
    const releasePositioningSession = vi.fn(async () => undefined);
    const handlers = createPositioningAiTaskHandlers({
      generate: vi.fn(),
      persistProfileExtract: vi.fn(async () => undefined),
      persistPositioningReport: vi.fn(async () => undefined),
      releasePositioningSession,
    });
    const transaction = { kind: "worker-failure-transaction" } as unknown as CreatorCompassDatabase;
    const release = await handlers.profile_extract!.onTerminalFailure!(run);
    await release.persist(transaction);
    expect(releasePositioningSession).toHaveBeenCalledWith(transaction, run);
  });
});
