import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  createReviewFromConfirmedFields,
  requestReviewReport,
  retryReviewReport,
  requestReviewTasks,
  type ReviewRepository,
} from "./review-service";

const actor: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};
const reviewId = "20000000-0000-4000-8000-000000000002";

function repository(overrides: Partial<ReviewRepository> = {}): ReviewRepository {
  const repo: ReviewRepository = {
    transaction: async (work) => work(repo),
    findMatchingReview: vi.fn(async () => null),
    createReview: vi.fn(async () => ({ id: reviewId })),
    attachPrivateObject: vi.fn(async () => undefined),
    findLatestSnapshot: vi.fn(async () => null),
    insertSnapshot: vi.fn(async () => ({ id: "30000000-0000-4000-8000-000000000003" })),
    findReview: vi.fn(async () => ({ id: reviewId, status: "draft" as const })),
    setReviewStatus: vi.fn(async () => undefined),
    findRunByKey: vi.fn(async () => null),
    findRun: vi.fn(async () => null),
    findActiveRun: vi.fn(async () => null),
    ...overrides,
  };
  return repo;
}

describe("review service", () => {
  test("tracks completed data acquisition without inventing a snapshot version", async () => {
    const repo = repository();
    const track = vi.fn(async () => undefined);

    await createReviewFromConfirmedFields(actor, {
      platform: "xiaohongshu",
      title: "校园效率工具实测",
      sourceMode: "manual",
      metrics: { views: 1_000, likes: 40, comments: 8 },
    }, repo, track);

    expect(track).toHaveBeenCalledWith(actor, {
      eventName: "data_acquisition_completed",
      flow: "review",
      metadata: { metricCount: 3 },
    });
    const trackedEvent = (track.mock.calls as unknown as Array<[CurrentActor, Record<string, unknown>]>)[0]?.[1];
    expect(trackedEvent).not.toHaveProperty("entityVersion");
  });

  test("does not track data acquisition when the snapshot write fails", async () => {
    const track = vi.fn(async () => undefined);
    const repo = repository({ insertSnapshot: vi.fn(async () => { throw new Error("SNAPSHOT_CREATE_FAILED"); }) });

    await expect(createReviewFromConfirmedFields(actor, {
      platform: "xiaohongshu", title: "保存失败", sourceMode: "manual", metrics: { views: 100 },
    }, repo, track)).rejects.toThrow("SNAPSHOT_CREATE_FAILED");

    expect(track).not.toHaveBeenCalled();
  });

  test("keeps acquired data when analytics fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await createReviewFromConfirmedFields(actor, {
      platform: "xiaohongshu", title: "埋点失败", sourceMode: "manual", metrics: { views: 100 },
    }, repository(), vi.fn(async () => { throw new Error("raw-review-data-must-not-leak"); }));

    expect(result.snapshotId).toBe("30000000-0000-4000-8000-000000000003");
    expect(consoleError).toHaveBeenCalledWith("PRODUCT_ANALYTICS_WRITE_FAILED");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw-review-data-must-not-leak");
    consoleError.mockRestore();
  });

  test("stores confirmed source fields separately from calculated metrics", async () => {
    const repo = repository();
    const result = await createReviewFromConfirmedFields(actor, {
      platform: "xiaohongshu",
      title: "校园效率工具实测",
      publishedAt: "2026-08-08T12:00:00+08:00",
      sourceMode: "ocr",
      metrics: { views: 1_000, likes: 40, comments: 8, favorites: 7, shares: 5 },
    }, repo);

    expect(result.reviewId).toBe(reviewId);
    expect(repo.insertSnapshot).toHaveBeenCalledWith(reviewId, expect.objectContaining({
      confirmedMetrics: expect.objectContaining({ views: 1_000, likes: 40 }),
      calculatedMetrics: expect.objectContaining({ interactionCount: 60, interactionRate: 0.06 }),
    }));
  });

  test("attaches an explicitly uploaded actor-scoped screenshot", async () => {
    const repo = repository();
    await createReviewFromConfirmedFields(actor, {
      platform: "douyin", title: "私有截图", sourceMode: "ocr", metrics: { views: 100, likes: 2 },
      privateObjectKey: `private/user/${actor.userId}/review.png`,
    }, repo);
    expect(repo.attachPrivateObject).toHaveBeenCalledWith(actor, reviewId, `private/user/${actor.userId}/review.png`, expect.any(Date));
  });

  test("creates another snapshot when the same content is reviewed again", async () => {
    const repo = repository({
      findMatchingReview: vi.fn(async () => ({ id: reviewId, status: "ready" as const })),
      findLatestSnapshot: vi.fn(async () => ({ confirmedMetrics: { views: 1_000, likes: 40 } })),
    });
    await createReviewFromConfirmedFields(actor, {
      platform: "xiaohongshu", title: "同一条内容", sourceMode: "manual",
      publishedAt: "2026-08-08T12:00:00+08:00",
      metrics: { views: 1_500, likes: 75 },
    }, repo);

    expect(repo.createReview).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).toHaveBeenCalledWith(reviewId, expect.objectContaining({
      calculatedMetrics: expect.objectContaining({ viewGrowthRate: 0.5 }),
    }));
    expect(repo.setReviewStatus).toHaveBeenCalledWith(actor, reviewId, "draft");
  });

  test("requests one owner-scoped idempotent review report", async () => {
    const repo = repository();
    const enqueue = vi.fn(async () => ({ aiRunId: "40000000-0000-4000-8000-000000000004", status: "processing" as const }));
    const result = await requestReviewReport(actor, { reviewId, idempotencyKey: "review-v1" }, {
      repository: repo,
      enqueue,
    });

    expect(result.aiRunId).toBe("40000000-0000-4000-8000-000000000004");
    expect(repo.setReviewStatus).toHaveBeenCalledWith(actor, reviewId, "processing");
    expect(enqueue).toHaveBeenCalledWith(actor, {
      taskType: "review_report", entityId: reviewId, idempotencyKey: "review-v1",
    });
  });

  test("retries only the failed report run owned by this review", async () => {
    const failedRunId = "40000000-0000-4000-8000-000000000004";
    const repo = repository({
      findRun: vi.fn(async () => ({ id: failedRunId, status: "failed" as const })),
    });
    const enqueue = vi.fn(async () => ({ aiRunId: "50000000-0000-4000-8000-000000000005" }));

    await expect(retryReviewReport(actor, { reviewId, failedRunId }, {
      repository: repo,
      enqueue,
    })).resolves.toMatchObject({ aiRunId: "50000000-0000-4000-8000-000000000005" });

    expect(enqueue).toHaveBeenCalledWith(actor, {
      taskType: "review_report",
      entityId: reviewId,
      idempotencyKey: `retry:${failedRunId}`,
    });
  });

  test("rejects retrying a run outside the owned review", async () => {
    await expect(retryReviewReport(actor, {
      reviewId,
      failedRunId: "40000000-0000-4000-8000-000000000004",
    }, { repository: repository(), enqueue: vi.fn() })).rejects.toThrow("AI_RUN_NOT_RETRYABLE");
  });

  test("commits only selected actions from the owned report version", async () => {
    const task = { id: "50000000-0000-4000-8000-000000000005", title: "补充清单", reason: "验证", steps: ["整理"], completionCriteria: "发布", estimatedMinutes: 30, priority: 1 as const, plannedDate: "2026-08-10" };
    const commit = vi.fn(async () => []);
    await requestReviewTasks(actor, {
      reportId: "60000000-0000-4000-8000-000000000006", version: 1, selectedTaskIds: [task.id],
    }, {
      loadReport: vi.fn(async () => ({ actions: [task] })),
      commit,
    });
    expect(commit).toHaveBeenCalledWith(actor, expect.objectContaining({
      idempotencyKey: "review:60000000-0000-4000-8000-000000000006:1",
      tasks: [expect.objectContaining({ clientId: task.id, selected: true })],
    }));
  });

  test("rejects a task id that is not in the report", async () => {
    await expect(requestReviewTasks(actor, {
      reportId: "60000000-0000-4000-8000-000000000006", version: 1,
      selectedTaskIds: ["70000000-0000-4000-8000-000000000007"],
    }, {
      loadReport: vi.fn(async () => ({ actions: [] })),
      commit: vi.fn(async () => []),
    })).rejects.toThrow("INVALID_TASK_SELECTION");
  });
});
