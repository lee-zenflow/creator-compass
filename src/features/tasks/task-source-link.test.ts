import { describe, expect, test } from "vitest";

import { taskSourceHref } from "./task-source-link";

describe("taskSourceHref", () => {
  test.each([
    [
      { type: "positioning" as const, entityId: "session-1", reportId: "report-1", version: 2 },
      "/positioning/session-1/report?report=report-1&version=2",
    ],
    [
      { type: "creation" as const, entityId: "project-1", reportId: "report-2", version: 3 },
      "/creation/project-1/plan?report=report-2&version=3",
    ],
    [
      { type: "review" as const, entityId: "review-1", reportId: "report-3", version: 1 },
      "/reviews/review-1/report?report=report-3&version=1",
    ],
  ])("links a %s task to its exact report version", (source, expected) => {
    expect(taskSourceHref(source)).toBe(expected);
  });

  test("falls back to the report record for historical snapshots without an entity id", () => {
    expect(taskSourceHref({
      type: "review",
      entityId: null,
      reportId: "report-3",
      version: 1,
    })).toBe("/reports?report=report-3");
  });
});
