import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  buildCandidateFailureUrl,
  buildTaskFailureUrl,
  commitPositioningTasksIntent,
  confirmCandidateIntent,
  createPositioningSessionIntent,
  requestReportIntent,
  retryPositioningIntent,
  sendInterviewIntent,
  updateProfileIntent,
} from "./positioning-actions";

const actor: CurrentActor = { kind: "guest", guestSessionId: "guest-1" };

describe("positioning action intents", () => {
  test("reports missing DeepSeek configuration without claiming generation started", async () => {
    const send = vi.fn(async () => ({ messageId: "message-1", aiRunId: null, aiStatus: "not_configured" as const }));
    const result = await sendInterviewIntent(actor, { sessionId: crypto.randomUUID(), clientMessageId: "message-key-1", message: "每天一小时" }, {
      send,
    });
    expect(result).toEqual({ ok: false, code: "NOT_CONFIGURED", message: "AI 尚未配置，回答已保存。配置后可重试。" });
    expect(send).toHaveBeenCalledWith(actor, expect.objectContaining({ clientMessageId: "message-key-1" }));
  });

  test("returns a real run id when report generation is queued", async () => {
    const request = vi.fn(async () => ({ aiRunId: "run-1", aiStatus: "processing" as const }));
    const result = await requestReportIntent(actor, { sessionId: crypto.randomUUID(), idempotencyKey: "report-key-1" }, {
      request,
    });
    expect(result).toEqual({ ok: true, code: "PROCESSING", aiRunId: "run-1" });
    expect(request).toHaveBeenCalledWith(actor, expect.objectContaining({ idempotencyKey: "report-key-1" }));
  });

  test("retries a failed run without inserting a duplicate user message", async () => {
    const retry = vi.fn(async () => ({ aiRunId: "run-retry-1", aiStatus: "processing" as const }));
    const result = await retryPositioningIntent(actor, {
      sessionId: crypto.randomUUID(),
      failedRunId: crypto.randomUUID(),
      idempotencyKey: "retry-key-1",
    }, { retry });
    expect(result).toEqual({ ok: true, code: "PROCESSING", aiRunId: "run-retry-1" });
    expect(retry).toHaveBeenCalledOnce();
  });

  test("maps the ten-round interview limit to an actionable message", async () => {
    const result = await sendInterviewIntent(actor, { sessionId: crypto.randomUUID(), clientMessageId: "message-key-2", message: "继续" }, {
      send: async () => { throw new Error("INTERVIEW_LIMIT_REACHED"); },
    });
    expect(result).toEqual({ ok: false, code: "INTERVIEW_LIMIT", message: "最多 10 轮核心访谈，可直接生成报告或查看画像。" });
  });

  test("creates one owned draft session", async () => {
    const create = vi.fn(async () => ({ id: "session-1" }));
    await expect(createPositioningSessionIntent(actor, { create })).resolves.toEqual({ ok: true, sessionId: "session-1" });
    expect(create).toHaveBeenCalledWith(actor);
  });

  test("confirmation forwards optimistic profile version", async () => {
    const confirm = vi.fn(async () => ({ reportVersion: 2, profileVersion: 3, taskPreviewSource: { reportId: "report-1", reportVersion: 2, candidateId: "candidate-a" } }));
    const track = vi.fn(async () => undefined);
    const result = await confirmCandidateIntent(actor, { reportId: crypto.randomUUID(), reportVersion: 1, candidateId: "candidate-a", expectedProfileVersion: 2 }, { confirm, track });
    expect(result).toMatchObject({ ok: true, reportVersion: 2, profileVersion: 3 });
    expect(track).toHaveBeenCalledWith(actor, {
      eventName: "positioning_confirmed",
      flow: "positioning",
      entityVersion: 2,
      metadata: {},
    });
  });

  test("does not track positioning when confirmation fails", async () => {
    const track = vi.fn(async () => undefined);
    const result = await confirmCandidateIntent(actor, {
      reportId: crypto.randomUUID(), reportVersion: 1, candidateId: "candidate-a", expectedProfileVersion: 2,
    }, {
      confirm: vi.fn(async () => { throw new Error("REPORT_NOT_READY"); }),
      track,
    });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(track).not.toHaveBeenCalled();
  });

  test("keeps a successful confirmation when analytics fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await confirmCandidateIntent(actor, {
      reportId: crypto.randomUUID(), reportVersion: 1, candidateId: "candidate-a", expectedProfileVersion: 2,
    }, {
      confirm: vi.fn(async () => ({ reportVersion: 2, profileVersion: 3, taskPreviewSource: { reportId: "report-1", reportVersion: 2, candidateId: "candidate-a" } })),
      track: vi.fn(async () => { throw new Error("raw-confirmation-must-not-leak"); }),
    });

    expect(result).toMatchObject({ ok: true, reportVersion: 2, profileVersion: 3 });
    expect(consoleError).toHaveBeenCalledWith("PRODUCT_ANALYTICS_WRITE_FAILED");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw-confirmation-must-not-leak");
    consoleError.mockRestore();
  });

  test("commits only selected tasks from the owned confirmed report", async () => {
    const commit = vi.fn(async () => [{ id: "saved-task-1" }]);
    const result = await commitPositioningTasksIntent(actor, {
      reportId: crypto.randomUUID(), reportVersion: 2, candidateId: "candidate-a", selectedTaskIds: ["task-1"],
    }, {
      readConfirmedCandidate: async () => ({
        report: { id: "typed-1", reportId: "report-1", version: 2, status: "ready", generationMode: "manual", candidates: [], selectedCandidate: { id: "candidate-a" } },
        candidate: { id: "candidate-a", name: "方向", audience: "大学生", direction: "实测", contentPillars: ["一", "二", "三"], matchExplanation: "匹配", risks: [], citations: [], initialTasks: [{ id: "task-1", title: "列工具", reason: "验证", steps: ["记录"], plannedDate: "2026-08-10", completionCriteria: "列出5个", estimatedMinutes: 20, priority: 1 }] },
      }),
      commit,
    });
    expect(result).toEqual({ ok: true, count: 1 });
    expect(commit).toHaveBeenCalledWith(actor, expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^positioning:[0-9a-f-]+:2$/),
      tasks: [expect.objectContaining({ clientId: "task-1", selected: true })],
    }));
  });

  test("rejects selected task ids that do not belong to the confirmed candidate", async () => {
    const commit = vi.fn(async () => []);
    const result = await commitPositioningTasksIntent(actor, {
      reportId: crypto.randomUUID(), reportVersion: 2, candidateId: "candidate-a", selectedTaskIds: ["task-1", "forged-task"],
    }, {
      readConfirmedCandidate: async () => ({
        report: { id: "typed-1", reportId: "report-1", version: 2, status: "ready", generationMode: "manual", candidates: [], selectedCandidate: { id: "candidate-a" } },
        candidate: { id: "candidate-a", name: "方向", audience: "大学生", direction: "实测", contentPillars: ["一", "二", "三"], matchExplanation: "匹配", risks: [], citations: [], initialTasks: [{ id: "task-1", title: "列工具", reason: "验证", steps: ["记录"], plannedDate: "2026-08-10", completionCriteria: "列出5个", estimatedMinutes: 20, priority: 1 }] },
      }),
      commit,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_INPUT", message: "选择的任务与已确认方向不一致，请刷新后重试。" });
    expect(commit).not.toHaveBeenCalled();
  });

  test("manual profile edit creates the next version through one owned update", async () => {
    const update = vi.fn(async () => ({ profileVersion: 4 }));
    const result = await updateProfileIntent(actor, {
      expectedVersion: 3, currentPositioning: "校园效率实测", targetAudience: "大学生", contentDirection: "工具实测与复盘",
    }, { update });
    expect(result).toEqual({ ok: true, profileVersion: 4 });
  });

  test("failure redirects preserve the report identity needed to retry", async () => {
    await expect(buildCandidateFailureUrl({ sessionId: "s1", candidateId: "c1", reportId: "r1", version: 2, notice: "conflict" }))
      .resolves.toBe("/positioning/s1/report/c1?report=r1&version=2&notice=conflict");
    await expect(buildTaskFailureUrl({ sessionId: "s1", candidateId: "c1", reportId: "r1", version: 2, notice: "failed" }))
      .resolves.toBe("/positioning/s1/tasks?report=r1&version=2&candidate=c1&notice=failed");
  });
});
