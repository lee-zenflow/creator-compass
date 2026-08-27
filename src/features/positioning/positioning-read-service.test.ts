import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  getActiveCreatorProfile,
  getConfirmedPositioningCandidate,
  getPositioningCandidate,
  getPositioningFlow,
  getPositioningReportForSession,
  listPositioningRecords,
  type PositioningReadRepository,
} from "./positioning-read-service";

const actor: CurrentActor = { kind: "guest", guestSessionId: "guest-1" };

function repository(overrides: Partial<PositioningReadRepository> = {}): PositioningReadRepository {
  return {
    listSessions: async () => [],
    getSession: async () => null,
    listMessages: async () => [],
    getLatestRun: async () => null,
    getLatestReport: async () => null,
    getReportVersion: async () => null,
    getActiveProfile: async () => null,
    ...overrides,
  };
}

describe("positioning read service", () => {
  test("lists persisted records without inventing a title or status", async () => {
    const createdAt = new Date("2026-08-09T08:00:00Z");
    const result = await listPositioningRecords(actor, repository({
      listSessions: async () => [{ id: "session-1", status: "draft", completeness: 62, currentStep: 4, createdAt, updatedAt: createdAt }],
    }));
    expect(result).toEqual([{ id: "session-1", status: "draft", completeness: 62, currentStep: 4, createdAt, updatedAt: createdAt }]);
  });

  test("restores messages, the latest real run, and the latest report after refresh", async () => {
    const session = { id: "session-1", status: "processing" as const, completeness: 80, currentStep: 5, createdAt: new Date(), updatedAt: new Date() };
    const flow = await getPositioningFlow(actor, "session-1", repository({
      getSession: async () => session,
      listMessages: async () => [{ id: "message-1", sender: "assistant", content: "继续说明你的时间安排", createdAt: new Date() }],
      getLatestRun: async () => ({ id: "run-1", taskType: "profile_extract", status: "failed", errorCode: "TIMEOUT", safeErrorDetail: "AI generation timed out.", updatedAt: new Date() }),
      getLatestReport: async () => ({ id: "typed-1", reportId: "report-1", version: 1, status: "ready", generationMode: "ai", candidates: [], selectedCandidate: null }),
    }));
    expect(flow.session.completeness).toBe(80);
    expect(flow.messages[0]?.content).toContain("时间安排");
    expect(flow.latestRun?.status).toBe("failed");
    expect(flow.latestReport?.reportId).toBe("report-1");
  });

  test("rejects another actor's missing session instead of returning a blank fake flow", async () => {
    await expect(getPositioningFlow(actor, "session-404", repository())).rejects.toThrow("NOT_FOUND");
  });

  test("opens the exact owned report version linked by a task instead of silently showing the latest report", async () => {
    const session = { id: "session-1", status: "ready" as const, completeness: 100, currentStep: 8, createdAt: new Date(), updatedAt: new Date() };
    const historical = {
      id: "typed-1",
      positioningSessionId: "session-1",
      reportId: "report-1",
      version: 1,
      status: "ready" as const,
      generationMode: "ai" as const,
      candidates: [],
      selectedCandidate: null,
    };
    const latest = { ...historical, id: "typed-3", version: 3 };
    const exact = await getPositioningReportForSession(actor, "session-1", { reportId: "report-1", version: 1 }, repository({
      getSession: async () => session,
      getLatestReport: async () => latest,
      getReportVersion: async () => historical,
    }));
    expect(exact.version).toBe(1);
  });

  test("rejects a report version that belongs to a different positioning session", async () => {
    const session = { id: "session-1", status: "ready" as const, completeness: 100, currentStep: 8, createdAt: new Date(), updatedAt: new Date() };
    await expect(getPositioningReportForSession(actor, "session-1", { reportId: "report-2", version: 1 }, repository({
      getSession: async () => session,
      getReportVersion: async () => ({
        id: "typed-2",
        positioningSessionId: "session-2",
        reportId: "report-2",
        version: 1,
        status: "ready",
        generationMode: "ai",
        candidates: [],
        selectedCandidate: null,
      }),
    }))).rejects.toThrow("NOT_FOUND");
  });

  test("returns only a validated candidate from an owned ready report", async () => {
    const candidate = {
      id: "10000000-0000-4000-8000-000000000001", name: "校园效率工具实测", audience: "大学生", direction: "真实场景测试",
      contentPillars: ["实测", "教程", "复盘"], matchExplanation: "与访谈证据匹配", risks: ["样本有限"], citations: [],
      initialTasks: [1, 2, 3].map((index) => ({ id: `20000000-0000-4000-8000-00000000000${index}`, title: `任务${index}`, reason: "验证方向", steps: ["记录"], plannedDate: "2026-08-10", completionCriteria: "完成记录", estimatedMinutes: 20, priority: 1 as const })),
    };
    const result = await getPositioningCandidate(actor, "report-1", 1, "10000000-0000-4000-8000-000000000001", repository({
      getReportVersion: async () => ({ id: "typed-1", reportId: "report-1", version: 1, status: "ready", generationMode: "ai", candidates: [candidate], selectedCandidate: null }),
    }));
    expect(result.candidate.name).toBe("校园效率工具实测");
    await expect(getPositioningCandidate(actor, "report-1", 1, "missing", repository({
      getReportVersion: async () => ({ id: "typed-1", reportId: "report-1", version: 1, status: "ready", generationMode: "ai", candidates: [candidate], selectedCandidate: null }),
    }))).rejects.toThrow("NOT_FOUND");
  });

  test("returns null when no active profile has been confirmed", async () => {
    await expect(getActiveCreatorProfile(actor, repository())).resolves.toBeNull();
  });

  test("manual task preview only exposes the candidate that was actually confirmed", async () => {
    const task = (id: string) => ({ id, title: "任务", reason: "验证", steps: ["执行"], plannedDate: "2026-08-10", completionCriteria: "完成", estimatedMinutes: 20, priority: 1 as const });
    const candidateA = { id: "10000000-0000-4000-8000-000000000001", name: "方向A", audience: "大学生", direction: "实测", contentPillars: ["一", "二", "三"], matchExplanation: "匹配", risks: [], citations: [], initialTasks: [task("20000000-0000-4000-8000-000000000001"), task("20000000-0000-4000-8000-000000000002"), task("20000000-0000-4000-8000-000000000003")] };
    const candidateB = { ...candidateA, id: "10000000-0000-4000-8000-000000000002", name: "方向B" };
    const manual = { id: "typed-2", reportId: "report-1", version: 2, status: "ready" as const, generationMode: "manual" as const, candidates: [candidateA, candidateB], selectedCandidate: candidateA };
    const repo = repository({ getReportVersion: async () => manual });
    await expect(getConfirmedPositioningCandidate(actor, "report-1", 2, candidateA.id, repo)).resolves.toMatchObject({ candidate: { id: candidateA.id } });
    await expect(getConfirmedPositioningCandidate(actor, "report-1", 2, candidateB.id, repo)).rejects.toThrow("CONFIRMED_CANDIDATE_MISMATCH");
  });
});
