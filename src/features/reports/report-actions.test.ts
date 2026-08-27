import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { CurrentActor } from "@/features/identity/current-actor";

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  restore: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})), headers: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: vi.fn(async () => owner) }));
vi.mock("./report-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("./report-service")>(),
  archiveReport: mocks.archive,
  restoreReport: mocks.restore,
}));

import {
  archiveReportAction,
  archiveReportIntent,
  restoreReportAction,
  restoreReportIntent,
} from "./report-actions";
import { reportNoticeHref } from "./report-navigation";

const owner: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};
const reportId = "20000000-0000-4000-8000-000000000002";
const record = {
  id: reportId,
  owner,
  type: "creation" as const,
  title: "第一条视频",
  summary: null,
  status: "ready" as const,
  createdAt: new Date("2026-08-20T08:00:00Z"),
  updatedAt: new Date("2026-08-20T09:00:00Z"),
};

test("keeps synchronous navigation helpers outside the Server Action module", () => {
  const source = readFileSync("src/features/reports/report-actions.ts", "utf8");
  expect(source).not.toContain("export function reportNoticeHref");
});

test("archive and restore intents accept only parsed report and filter context", async () => {
  const archive = vi.fn(async () => ({ ...record, status: "archived" as const }));
  const restore = vi.fn(async () => record);

  await expect(archiveReportIntent(owner, {
    reportId,
    type: "creation",
    view: "archived",
  }, { archive })).resolves.toEqual({ ok: true, type: "creation", view: "archived" });
  await expect(restoreReportIntent(owner, {
    reportId,
    type: "all",
    view: "active",
  }, { restore })).resolves.toEqual({ ok: true, type: "all", view: "active" });
  expect(archive).toHaveBeenCalledWith(owner, reportId);
  expect(restore).toHaveBeenCalledWith(owner, reportId);
  const forged = { reportId, type: "review", view: "active", ownerId: "forged" };
  await expect(archiveReportIntent(owner, forged, { archive }))
    .rejects.toThrow();
  await expect(archiveReportIntent(owner, {
    reportId,
    type: "admin",
    view: "deleted",
  }, { archive })).rejects.toThrow();
});

test("builds fixed report notices without reflecting arbitrary input", () => {
  expect(reportNoticeHref("active", "positioning", "archived"))
    .toBe("/reports?type=positioning&notice=archived");
  expect(reportNoticeHref("active", "all", "restored")).toBe("/reports?notice=restored");
  expect(reportNoticeHref("archived", "review", "failed"))
    .toBe("/reports?view=archived&type=review&notice=failed");
});

function actionForm(type: string, view: string) {
  const form = new FormData();
  form.set("reportId", reportId);
  form.set("type", type);
  form.set("view", view);
  form.set("ownerId", "attacker-owner");
  return form;
}

describe("report action return context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archive.mockResolvedValue({ ...record, status: "archived" });
    mocks.restore.mockResolvedValue(record);
  });

  test("returns successful archive and restore to active view with the same safe type", async () => {
    await archiveReportAction(actionForm("creation", "archived"));
    expect(mocks.redirect).toHaveBeenCalledWith("/reports?type=creation&notice=archived");

    mocks.redirect.mockClear();
    await restoreReportAction(actionForm("review", "archived"));
    expect(mocks.redirect).toHaveBeenCalledWith("/reports?type=review&notice=restored");
  });

  test("keeps the original safe view and type after failure", async () => {
    mocks.archive.mockRejectedValue(new Error("FAILED"));
    await archiveReportAction(actionForm("positioning", "archived"));
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/reports?view=archived&type=positioning&notice=failed",
    );
  });

  test("drops untrusted return context and never forwards a submitted owner", async () => {
    await archiveReportAction(actionForm("admin", "deleted"));
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/reports?notice=failed");
  });
});
