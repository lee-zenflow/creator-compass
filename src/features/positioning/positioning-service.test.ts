import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { AiFailure } from "@/server/ai/deepseek-client";
import {
  confirmPositioningCandidate,
  requestPositioningReport,
  retryPositioningRun,
  sendInterviewMessage,
  type PositioningRepository,
} from "./positioning-service";

const actor: CurrentActor = { kind: "guest", guestSessionId: "00000000-0000-4000-8000-000000000010" };

function repository(overrides: Partial<PositioningRepository> = {}): PositioningRepository {
  const result = {} as PositioningRepository;
  const transaction: PositioningRepository["transaction"] = async (work) => work(result);
  Object.assign(result, {
    transaction,
    findOwnedSession: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000020",
      completeness: 81,
      currentStep: 6,
      draft: {},
      status: "draft" as const,
    })),
    findUserMessageByClientId: vi.fn(async () => null),
    findProcessingPositioningRun: vi.fn(async () => null),
    findPositioningRunByKey: vi.fn(async () => null),
    findOwnedPositioningRun: vi.fn(async () => null),
    insertUserMessage: vi.fn(async (_actor, input) => ({ id: "00000000-0000-4000-8000-000000000030", ...input })),
    markSessionIdle: vi.fn(async () => undefined),
    markSessionProcessing: vi.fn(async () => undefined),
    findOwnedReportVersion: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000040",
      reportId: "00000000-0000-4000-8000-000000000041",
      version: 1,
      generationMode: "ai" as const,
      status: "ready" as const,
      positioningSessionId: "00000000-0000-4000-8000-000000000020",
      selectedCandidate: null,
      candidates: [{
        id: "10000000-0000-4000-8000-000000000001",
        name: "Focused maker",
        audience: "Creators",
        direction: "Practical workflow",
        contentPillars: ["A", "B", "C"],
        matchExplanation: "Evidence match",
        risks: [],
        citations: [],
        initialTasks: [{
          id: "20000000-0000-4000-8000-000000000001",
          title: "Draft a topic",
          reason: "Validate",
          steps: ["Write"],
          plannedDate: "2026-08-10",
          completionCriteria: "A draft is saved.",
          estimatedMinutes: 30,
          priority: 1 as const,
        }, { id: "20000000-0000-4000-8000-000000000002", title: "Publish", reason: "Test", steps: ["Publish"], plannedDate: "2026-08-11", completionCriteria: "The test is published.", estimatedMinutes: 30, priority: 2 as const }, { id: "20000000-0000-4000-8000-000000000003", title: "Review", reason: "Learn", steps: ["Record"], plannedDate: "2026-08-12", completionCriteria: "Findings are recorded.", estimatedMinutes: 20, priority: 2 as const }],
      }, {
        id: "10000000-0000-4000-8000-000000000002", name: "Second", audience: "Creators", direction: "Second direction",
        contentPillars: ["A", "B", "C"], matchExplanation: "Evidence match", risks: [], citations: [],
        initialTasks: [{ id: "30000000-0000-4000-8000-000000000001", title: "A", reason: "A", steps: ["A"], plannedDate: "2026-08-10", completionCriteria: "A", estimatedMinutes: 20, priority: 1 as const }, { id: "30000000-0000-4000-8000-000000000002", title: "B", reason: "B", steps: ["B"], plannedDate: "2026-08-11", completionCriteria: "B", estimatedMinutes: 20, priority: 2 as const }, { id: "30000000-0000-4000-8000-000000000003", title: "C", reason: "C", steps: ["C"], plannedDate: "2026-08-12", completionCriteria: "C", estimatedMinutes: 20, priority: 2 as const }],
      }, {
        id: "10000000-0000-4000-8000-000000000003", name: "Third", audience: "Creators", direction: "Third direction",
        contentPillars: ["A", "B", "C"], matchExplanation: "Evidence match", risks: [], citations: [],
        initialTasks: [{ id: "40000000-0000-4000-8000-000000000001", title: "A", reason: "A", steps: ["A"], plannedDate: "2026-08-10", completionCriteria: "A", estimatedMinutes: 20, priority: 1 as const }, { id: "40000000-0000-4000-8000-000000000002", title: "B", reason: "B", steps: ["B"], plannedDate: "2026-08-11", completionCriteria: "B", estimatedMinutes: 20, priority: 2 as const }, { id: "40000000-0000-4000-8000-000000000003", title: "C", reason: "C", steps: ["C"], plannedDate: "2026-08-12", completionCriteria: "C", estimatedMinutes: 20, priority: 2 as const }],
      }],
    })),
    lockProfile: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000050", version: 2 })),
    findConfirmation: vi.fn(async () => null),
    appendManualConfirmation: vi.fn(async (_actor, input) => ({ reportVersion: input.parentVersion + 4, profileVersion: 3 })),
    ...overrides,
  });
  return result;
}

describe("positioning service", () => {
  test("stores a client-idempotent user message before reporting missing AI config", async () => {
    const repo = repository();
    const enqueue = vi.fn(async () => {
      throw new AiFailure("NOT_CONFIGURED", "missing", false);
    });
    const result = await sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-1",
      message: "I can create twice a week.",
    }, { repository: repo, enqueue });
    expect(repo.insertUserMessage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ aiStatus: "not_configured" });
  });

  test("does not idle the session when a competing message enqueue created an active run", async () => {
    const markSessionIdle = vi.fn(async () => undefined);
    const findProcessingPositioningRun = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000098",
        taskType: "profile_extract" as const,
        idempotencyKey: "message:competing-message",
      });
    const repo = repository({ findProcessingPositioningRun, markSessionIdle });
    const enqueueConflict = new Error("ACTIVE_RUN_CONFLICT");

    await expect(sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-lost-race",
      message: "This enqueue loses the race.",
    }, {
      repository: repo,
      enqueue: vi.fn(async () => { throw enqueueConflict; }),
    })).rejects.toBe(enqueueConflict);
    expect(findProcessingPositioningRun).toHaveBeenCalledTimes(2);
    expect(markSessionIdle).not.toHaveBeenCalled();
  });

  test("returns the existing message for a repeated clientMessageId", async () => {
    const existing = {
      id: "00000000-0000-4000-8000-000000000031",
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-1",
      message: "same",
    };
    const repo = repository({ findUserMessageByClientId: vi.fn(async () => existing) });
    const enqueue = vi.fn(async () => ({ aiRunId: "00000000-0000-4000-8000-000000000099" }));
    const result = await sendInterviewMessage(actor, {
      sessionId: existing.sessionId,
      clientMessageId: existing.clientMessageId,
      message: existing.message,
    }, { repository: repo, enqueue });
    expect(result).toMatchObject({ messageId: existing.id, aiRunId: "00000000-0000-4000-8000-000000000099" });
    expect(repo.insertUserMessage).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  test("rejects a clientMessageId reused with different content", async () => {
    const repo = repository({ findUserMessageByClientId: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000031",
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-1",
      message: "original",
    })) });
    await expect(sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-1",
      message: "changed",
    }, { repository: repo, enqueue: vi.fn() })).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
  });

  test("accepts user-supplied details after ten AI-led questions", async () => {
    const repo = repository({
      findOwnedSession: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000020",
        completeness: 90,
        currentStep: 10,
        draft: {},
        status: "draft" as const,
      })),
    });

    const enqueue = vi.fn(async () => ({ aiRunId: "00000000-0000-4000-8000-000000000099" }));
    await expect(sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-11",
      message: "This is supplemental information supplied by the user.",
    }, { repository: repo, enqueue })).resolves.toMatchObject({ aiStatus: "processing" });
    expect(repo.insertUserMessage).toHaveBeenCalledOnce();
  });

  test("recovers a stale processing session when no AI run is active", async () => {
    const markSessionIdle = vi.fn(async () => undefined);
    const repo = repository({
      findOwnedSession: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000020",
        completeness: 40,
        currentStep: 3,
        draft: {},
        status: "processing" as const,
        updatedAt: new Date(Date.now() - 5 * 60_000),
      })),
      findProcessingPositioningRun: vi.fn(async () => null),
      markSessionIdle,
    });
    const enqueue = vi.fn(async () => ({ aiRunId: "00000000-0000-4000-8000-000000000099" }));

    await expect(sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-after-stale-run",
      message: "I can continue now.",
    }, { repository: repo, enqueue })).resolves.toMatchObject({ aiStatus: "processing" });
    expect(markSessionIdle).toHaveBeenCalledOnce();
    expect(repo.insertUserMessage).toHaveBeenCalledOnce();
  });

  test("does not misclassify a freshly processing session as stale before enqueue finishes", async () => {
    const repo = repository({
      findOwnedSession: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000020",
        completeness: 40,
        currentStep: 3,
        draft: {},
        status: "processing" as const,
        updatedAt: new Date(),
      })),
      findProcessingPositioningRun: vi.fn(async () => null),
    });

    await expect(sendInterviewMessage(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      clientMessageId: "message-while-enqueue-pending",
      message: "Do not race the prior enqueue.",
    }, { repository: repo, enqueue: vi.fn() })).rejects.toThrow("AI_PROCESSING");
    expect(repo.markSessionIdle).not.toHaveBeenCalled();
    expect(repo.insertUserMessage).not.toHaveBeenCalled();
  });

  test("does not enqueue a formal report below eighty percent", async () => {
    const repo = repository({
      findOwnedSession: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000020", completeness: 79, currentStep: 5, draft: {}, status: "draft" as const })),
    });
    await expect(requestPositioningReport(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      idempotencyKey: "report-1",
    }, { repository: repo, enqueue: vi.fn() })).rejects.toThrow("PROFILE_INCOMPLETE");
  });

  test("returns the same processing report run for an idempotent retry", async () => {
    const repo = repository({
      findOwnedSession: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000020",
        completeness: 81,
        currentStep: 6,
        draft: {},
        status: "processing" as const,
      })),
      findPositioningRunByKey: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000099",
        status: "processing" as const,
      })),
    });
    const enqueue = vi.fn();

    await expect(requestPositioningReport(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      idempotencyKey: "report-1",
    }, { repository: repo, enqueue })).resolves.toEqual({
      aiRunId: "00000000-0000-4000-8000-000000000099",
      aiStatus: "processing",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("retries a failed positioning run with a new queue idempotency key", async () => {
    const markSessionProcessing = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => ({ aiRunId: "00000000-0000-4000-8000-000000000098" }));
    const repo = repository({
      findOwnedPositioningRun: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000097",
        taskType: "positioning_report" as const,
        status: "failed" as const,
      })),
      markSessionProcessing,
    });

    await expect(retryPositioningRun(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      failedRunId: "00000000-0000-4000-8000-000000000097",
      idempotencyKey: "retry:00000000-0000-4000-8000-000000000097:1",
    }, { repository: repo, enqueue })).resolves.toEqual({
      aiRunId: "00000000-0000-4000-8000-000000000098",
      aiStatus: "processing",
    });
    expect(markSessionProcessing).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(actor, expect.objectContaining({
      taskType: "positioning_report",
      idempotencyKey: "retry:00000000-0000-4000-8000-000000000097:1",
    }));
  });

  test("does not retry a run that is not failed and owned by the session", async () => {
    const repo = repository({
      findOwnedPositioningRun: vi.fn(async () => null),
    });
    await expect(retryPositioningRun(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      failedRunId: "00000000-0000-4000-8000-000000000097",
      idempotencyKey: "retry-key",
    }, { repository: repo, enqueue: vi.fn() })).rejects.toThrow("AI_RUN_NOT_RETRYABLE");
  });

  test("does not idle the session when a competing report key wins the enqueue race", async () => {
    const markSessionIdle = vi.fn(async () => undefined);
    const repo = repository({
      findProcessingPositioningRun: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000098",
        taskType: "positioning_report" as const,
        idempotencyKey: "report-competing-key",
      })),
      markSessionIdle,
    });
    const enqueueConflict = new Error("ACTIVE_RUN_CONFLICT");

    await expect(requestPositioningReport(actor, {
      sessionId: "00000000-0000-4000-8000-000000000020",
      idempotencyKey: "report-lost-key",
    }, {
      repository: repo,
      enqueue: vi.fn(async () => { throw enqueueConflict; }),
    })).rejects.toBe(enqueueConflict);
    expect(markSessionIdle).not.toHaveBeenCalled();
  });

  test("confirmation appends a manual child version without mutating the AI version", async () => {
    const repo = repository();
    const result = await confirmPositioningCandidate(actor, {
      reportId: "00000000-0000-4000-8000-000000000041",
      reportVersion: 1,
      candidateId: "10000000-0000-4000-8000-000000000001",
      expectedProfileVersion: 2,
    }, { repository: repo });
    expect(repo.appendManualConfirmation).toHaveBeenCalledWith(actor, expect.objectContaining({
      parentVersion: 1,
      expectedProfileVersion: 2,
    }));
    expect(result.taskPreviewSource).toMatchObject({ reportVersion: 5, candidateId: "10000000-0000-4000-8000-000000000001" });
  });

  test("rechecks confirmation after acquiring the report lock", async () => {
    let reportLocked = false;
    const repo = repository();
    const findOwnedReportVersion = repo.findOwnedReportVersion;
    repo.findOwnedReportVersion = vi.fn(async (currentActor, reportId, reportVersion) => {
      const report = await findOwnedReportVersion(currentActor, reportId, reportVersion);
      reportLocked = true;
      return report;
    });
    repo.findConfirmation = vi.fn(async () => reportLocked
      ? { reportVersion: 7, profileVersion: 4 }
      : null);

    const result = await confirmPositioningCandidate(actor, {
      reportId: "00000000-0000-4000-8000-000000000041",
      reportVersion: 1,
      candidateId: "10000000-0000-4000-8000-000000000001",
      expectedProfileVersion: 2,
    }, { repository: repo });

    expect(result).toMatchObject({ reportVersion: 7, profileVersion: 4 });
    expect(repo.appendManualConfirmation).not.toHaveBeenCalled();
  });

  test("confirmation rejects stale profile versions", async () => {
    const repo = repository();
    await expect(confirmPositioningCandidate(actor, {
      reportId: "00000000-0000-4000-8000-000000000041",
      reportVersion: 1,
      candidateId: "10000000-0000-4000-8000-000000000001",
      expectedProfileVersion: 1,
    }, { repository: repo })).rejects.toThrow("PROFILE_VERSION_CONFLICT");
  });
});
