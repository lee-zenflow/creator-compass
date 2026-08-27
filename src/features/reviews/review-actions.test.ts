import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";

const mocks = vi.hoisted(() => ({
  appendReportVersion: vi.fn(),
  getReviewReportVersion: vi.fn(),
  getReviewState: vi.fn(),
  redirect: vi.fn(),
  track: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})), headers: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: vi.fn(async () => actor) }));
vi.mock("@/features/analytics/analytics-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/analytics/analytics-service")>(),
  trackProductEvent: mocks.track,
}));
vi.mock("@/features/reports/report-service", () => ({ appendReportVersion: mocks.appendReportVersion }));
vi.mock("@/server/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/storage/local-storage", () => ({ getPrivateStorage: vi.fn() }));
vi.mock("./review-read-service", () => ({
  getReviewReportVersion: mocks.getReviewReportVersion,
  getReviewState: mocks.getReviewState,
}));
vi.mock("./review-service", () => ({
  createReviewFromConfirmedFields: vi.fn(),
  requestReviewReport: vi.fn(),
  requestReviewTasks: vi.fn(),
}));

import { saveReviewReportAction } from "./review-actions";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const reviewId = "20000000-0000-4000-8000-000000000002";
const reportId = "30000000-0000-4000-8000-000000000003";
const actionId = "40000000-0000-4000-8000-000000000004";

function reviewForm() {
  const form = new FormData();
  form.set("reviewId", reviewId);
  form.set("reportId", reportId);
  form.set("parentVersion", "3");
  form.append("actionTitle", "补充对比");
  form.append("actionReason", "验证差异");
  form.append("actionSteps", "整理样本\n发布复测");
  form.append("actionCriteria", "完成一次复测");
  return form;
}

describe("review actions analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReviewReportVersion.mockResolvedValue({
      actions: [{
        id: actionId, title: "原行动", reason: "原原因", steps: ["原步骤"], completionCriteria: "原标准",
        plannedDate: "2026-08-12", estimatedMinutes: 30, priority: 1,
      }],
      dataSummary: {}, retained: [], problems: [], causes: [], citations: [], citationMode: "exact", legacySourceIds: [],
    });
    mocks.getReviewState.mockResolvedValue({ review: { contentTitle: "工具实测" } });
    mocks.appendReportVersion.mockResolvedValue({ version: { version: 4 } });
    mocks.track.mockResolvedValue(undefined);
    mocks.redirect.mockImplementation((url: string) => { throw { digest: `NEXT_REDIRECT:${url}` }; });
  });

  test("tracks review actions only after the new report version is saved", async () => {
    await expect(saveReviewReportAction(reviewForm())).rejects.toMatchObject({
      digest: `NEXT_REDIRECT:/reviews/${reviewId}/report?report=${reportId}&version=4`,
    });

    expect(mocks.track).toHaveBeenCalledWith(actor, {
      eventName: "review_actions_saved",
      flow: "review",
      entityVersion: 4,
      metadata: { itemCount: 1 },
    });
    expect(mocks.appendReportVersion.mock.invocationCallOrder[0]).toBeLessThan(mocks.track.mock.invocationCallOrder[0]!);
  });

  test("does not track review actions when saving the report version fails", async () => {
    mocks.appendReportVersion.mockRejectedValue(new Error("REPORT_VERSION_CREATE_FAILED"));

    await expect(saveReviewReportAction(reviewForm())).rejects.toMatchObject({
      digest: `NEXT_REDIRECT:/reviews/${reviewId}/report?report=${reportId}&version=3&edit=1&notice=save-failed`,
    });

    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("does not overwrite legacy source-only evidence when editing actions", async () => {
    mocks.getReviewReportVersion.mockResolvedValueOnce({
      actions: [{
        id: actionId, title: "原行动", reason: "原原因", steps: ["原步骤"], completionCriteria: "原标准",
        plannedDate: "2026-08-12", estimatedMinutes: 30, priority: 1,
      }],
      dataSummary: {}, retained: [], problems: [], causes: [], citations: [], citationMode: "legacy",
      legacySourceIds: ["50000000-0000-4000-8000-000000000005"],
    });

    await expect(saveReviewReportAction(reviewForm())).rejects.toMatchObject({
      digest: `NEXT_REDIRECT:/reviews/${reviewId}/report?report=${reportId}&version=3&notice=legacy-edit-disabled`,
    });

    expect(mocks.appendReportVersion).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("keeps the saved review actions when analytics fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.track.mockRejectedValue(new Error("raw-review-action-must-not-leak"));

    await expect(saveReviewReportAction(reviewForm())).rejects.toMatchObject({
      digest: `NEXT_REDIRECT:/reviews/${reviewId}/report?report=${reportId}&version=4`,
    });

    expect(consoleError).toHaveBeenCalledWith("PRODUCT_ANALYTICS_WRITE_FAILED");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw-review-action-must-not-leak");
    consoleError.mockRestore();
  });
});
