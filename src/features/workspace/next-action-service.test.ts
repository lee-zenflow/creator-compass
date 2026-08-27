import { describe, expect, test } from "vitest";

import {
  resolveNextAction,
  type NextActionFacts,
} from "./next-action-service";

const baseFacts: NextActionFacts = {
  hasProfile: true,
  hasPositioning: true,
  interview: null,
  processingRun: null,
  failedRun: null,
  unconfirmedPositioning: null,
  confirmedPositioning: null,
  creationProject: null,
  unsavedTaskSource: null,
  highestPriorityTask: null,
  publishedWithoutReview: null,
  reviewActionTask: null,
};

describe("resolveNextAction", () => {
  test.each([
    {
      name: "asks a new user to create a profile first",
      facts: { ...baseFacts, hasProfile: false },
      expected: { stage: "profile", href: "/me/profile", actionLabel: "去完善" },
    },
    {
      name: "starts positioning when no positioning exists",
      facts: { ...baseFacts, hasPositioning: false },
      expected: { stage: "positioning", href: "/positioning", actionLabel: "开始定位" },
    },
    {
      name: "continues an incomplete interview",
      facts: { ...baseFacts, interview: { href: "/positioning/session-1", status: "incomplete" as const } },
      expected: { stage: "positioning", href: "/positioning/session-1", actionLabel: "继续访谈" },
    },
    {
      name: "shows real positioning processing state",
      facts: { ...baseFacts, interview: { href: "/positioning/session-1", status: "processing" as const } },
      expected: { stage: "positioning", href: "/positioning/session-1", actionLabel: "查看进度" },
    },
    {
      name: "recovers a failed run before starting new work",
      facts: {
        ...baseFacts,
        failedRun: { taskType: "content_plan" as const, href: "/creation/project-1/plan" },
        highestPriorityTask: { id: "task-1", title: "较低优先级任务" },
      },
      expected: { stage: "creation", href: "/creation/project-1/plan", actionLabel: "重新生成" },
    },
    {
      name: "shows a real processing run without inventing progress",
      facts: {
        ...baseFacts,
        processingRun: { taskType: "review_report" as const, href: "/reviews/review-1/report" },
      },
      expected: { stage: "review", href: "/reviews/review-1/report", actionLabel: "查看进度" },
    },
    {
      name: "asks the user to confirm an available positioning report",
      facts: { ...baseFacts, unconfirmedPositioning: { href: "/positioning/session-1/report" } },
      expected: { stage: "positioning", href: "/positioning/session-1/report", actionLabel: "查看候选" },
    },
    {
      name: "starts creation after positioning confirmation",
      facts: {
        ...baseFacts,
        confirmedPositioning: { reportId: "report-1", version: 2 },
      },
      expected: { stage: "creation", href: "/creation/new", actionLabel: "开始创作" },
    },
    {
      name: "previews generated tasks before ordinary tasks",
      facts: {
        ...baseFacts,
        creationProject: { id: "project-1" },
        unsavedTaskSource: {
          href: "/creation/project-1/tasks?report=report-2&version=1",
          source: { type: "creation" as const, id: "report-2", version: 1 },
        },
        highestPriorityTask: { id: "task-1", title: "普通任务" },
      },
      expected: { stage: "task", href: "/creation/project-1/tasks?report=report-2&version=1", actionLabel: "预览任务" },
    },
    {
      name: "opens the highest priority task",
      facts: {
        ...baseFacts,
        creationProject: { id: "project-1" },
        highestPriorityTask: { id: "task-1", title: "完成首版脚本" },
      },
      expected: { stage: "task", href: "/tasks/task-1", title: "完成首版脚本" },
    },
    {
      name: "starts a review for published content",
      facts: {
        ...baseFacts,
        creationProject: { id: "project-1" },
        publishedWithoutReview: { id: "published-1" },
      },
      expected: { stage: "review", href: "/reviews/new?source=published-1", actionLabel: "开始复盘" },
    },
    {
      name: "returns to creation when the loop has no pending work",
      facts: { ...baseFacts, creationProject: { id: "project-1" } },
      expected: { stage: "creation", href: "/creation/new", actionLabel: "新建创作" },
    },
  ])("$name", ({ facts, expected }) => {
    expect(resolveNextAction(facts)).toMatchObject(expected);
  });

  test("keeps report provenance on task preview actions", () => {
    const action = resolveNextAction({
      ...baseFacts,
      creationProject: { id: "project-1" },
      unsavedTaskSource: {
        href: "/creation/project-1/tasks?report=report-2&version=3",
        source: { type: "creation", id: "report-2", version: 3 },
      },
    });

    expect(action.source).toEqual({ type: "creation", id: "report-2", version: 3 });
  });
});
