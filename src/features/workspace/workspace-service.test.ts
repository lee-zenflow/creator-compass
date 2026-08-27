import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import type { NextActionFacts } from "./next-action-service";
import { getWorkspace, getWorkspaceView, type WorkspaceRepository } from "./workspace-service";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

const defaultJourney: NextActionFacts = {
  hasProfile: true,
  hasPositioning: true,
  interview: null,
  processingRun: null,
  failedRun: null,
  unconfirmedPositioning: null,
  confirmedPositioning: null,
  creationProject: { id: "50000000-0000-4000-8000-000000000005" },
  unsavedTaskSource: null,
  highestPriorityTask: null,
  publishedWithoutReview: null,
  reviewActionTask: null,
};

function repository(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  return {
    listAccounts: vi.fn(async () => [{ id: "20000000-0000-4000-8000-000000000002", platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true }]),
    listMetricPoints: vi.fn(async () => [{ capturedAt: new Date("2026-08-08T12:00:00+08:00"), confirmedMetrics: { views: 1_000 }, calculatedMetrics: { interactionRate: 0.06, followerConversionRate: 0.01 } }]),
    findLatestInsight: vi.fn(async () => ({ reportId: "30000000-0000-4000-8000-000000000003", reviewId: "40000000-0000-4000-8000-000000000004", version: 1, problem: "收藏率偏低", action: "补充清单型内容" })),
    listTasks: vi.fn(async () => [
      { id: "a", title: "过期", plannedDate: "2026-08-08", status: "pending" as const },
      { id: "b", title: "明天", plannedDate: "2026-08-10", status: "pending" as const },
      { id: "c", title: "已完成", plannedDate: "2026-08-11", status: "completed" as const },
      { id: "d", title: "三天后", plannedDate: "2026-08-12", status: "in_progress" as const },
      { id: "e", title: "太远", plannedDate: "2026-08-13", status: "pending" as const },
    ]),
    listRecentReports: vi.fn(async () => []),
    getJourneyFacts: vi.fn(async () => defaultJourney),
    ...overrides,
  };
}

describe("workspace", () => {
  test.each([3, 7, 30] as const)("accepts the supported %s day range", async (range) => {
    const target = repository();
    const view = await getWorkspaceView(actor, range, target, new Date("2026-08-09T12:00:00+08:00"));
    expect(view.range).toBe(range);
    expect(target.listMetricPoints).toHaveBeenCalledWith(actor, expect.any(String), expect.any(Date));
  });

  test("rejects a range outside 3, 7, and 30 days", async () => {
    await expect(getWorkspaceView(actor, 14 as never, repository())).rejects.toThrow();
  });

  test("does not fabricate exposure when confirmed snapshots have no exposure field", async () => {
    const view = await getWorkspaceView(actor, 7, repository({
      listMetricPoints: vi.fn(async () => [{
        capturedAt: new Date("2026-08-08T12:00:00+08:00"),
        confirmedMetrics: { likes: 8, comments: 2, favorites: 3, shares: 1 },
        calculatedMetrics: { interactionRate: 0.9 },
      }]),
    }));
    expect(view.kind).toBe("activeUser");
    if (view.kind !== "activeUser") return;
    expect(view.metrics?.views).toBeNull();
    expect(view.metrics?.interactionRate).toBeNull();
  });

  test("returns null metrics and a collection requirement when there is no confirmed snapshot", async () => {
    const view = await getWorkspaceView(actor, 7, repository({ listMetricPoints: vi.fn(async () => []) }));
    expect(view.kind).toBe("activeUser");
    if (view.kind !== "activeUser") return;
    expect(view.metrics).toBeNull();
    expect(view.historicalConclusion).toBeNull();
    expect(view.dataRequirement).toBe("至少需要 3 条已确认内容数据");
  });

  test("counts content rather than repeated snapshots and uses the latest confirmation per review", async () => {
    const fullMetrics = { likes: 5, comments: 1, favorites: 2, shares: 0, followersGained: 1 };
    const view = await getWorkspaceView(actor, 7, repository({
      listMetricPoints: vi.fn(async () => [
        { reviewId: "review-a", capturedAt: new Date("2026-08-07T12:00:00+08:00"), confirmedMetrics: { ...fullMetrics, views: 100 }, calculatedMetrics: {} },
        { reviewId: "review-a", capturedAt: new Date("2026-08-08T12:00:00+08:00"), confirmedMetrics: { ...fullMetrics, views: 150 }, calculatedMetrics: {} },
        { reviewId: "review-b", capturedAt: new Date("2026-08-08T13:00:00+08:00"), confirmedMetrics: { ...fullMetrics, views: 200 }, calculatedMetrics: {} },
      ]),
    }));
    expect(view.kind).toBe("activeUser");
    if (view.kind !== "activeUser") return;
    expect(view.metrics?.views).toBe(350);
    expect(view.historicalConclusion).toBeNull();
    expect(view.dataRequirement).toBe("至少需要 3 条已确认内容数据");
  });

  test("shows only future incomplete tasks within three days", async () => {
    const view = await getWorkspace(actor, 7, repository(), new Date("2026-08-09T12:00:00+08:00"));
    expect(view.kind).toBe("activeUser");
    if (view.kind !== "activeUser") return;
    expect(view.upcomingTasks.map((task) => task.id)).toEqual(["b", "d"]);
    expect(view.upcomingTasks.every((task) => !task.completed && task.daysFromToday >= 0 && task.daysFromToday <= 3)).toBe(true);
  });

  test("returns a real onboarding empty state when no account exists", async () => {
    const view = await getWorkspace(actor, 7, repository({ listAccounts: vi.fn(async () => []) }));
    expect(view).toEqual({
      kind: "newUser",
      range: 7,
      accounts: [],
      nextAction: expect.objectContaining({ stage: "creation", href: "/creation/new" }),
    });
  });

  test("derives the next action from actor-owned journey facts", async () => {
    const target = repository({
      getJourneyFacts: vi.fn(async () => ({
        ...defaultJourney,
        failedRun: {
          taskType: "review_report" as const,
          href: "/reviews/60000000-0000-4000-8000-000000000006/report",
        },
      })),
    });

    const view = await getWorkspace(actor, 7, target);

    expect(target.getJourneyFacts).toHaveBeenCalledWith(actor);
    expect(view.nextAction).toMatchObject({
      stage: "review",
      href: "/reviews/60000000-0000-4000-8000-000000000006/report",
      actionLabel: "重新生成",
    });
  });
});
