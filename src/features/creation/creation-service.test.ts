import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  attachMaterials,
  createCreationProject,
  requestContentPlan,
  retryContentPlan,
  saveContentPlanVersion,
  type CreationRepository,
} from "./creation-service";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

function repository(overrides: Partial<CreationRepository> = {}): CreationRepository {
  const repo: CreationRepository = {
    createProject: vi.fn(async () => ({ id: "20000000-0000-4000-8000-000000000002" })),
    findProject: vi.fn(async () => ({ id: "20000000-0000-4000-8000-000000000002", status: "draft" as const, contentType: "video" as const })),
    replaceMaterials: vi.fn(async () => undefined),
    setProjectStatus: vi.fn(async () => undefined),
    findRunByKey: vi.fn(async () => null),
    findRun: vi.fn(async () => null),
    findActiveRun: vi.fn(async () => null),
    findPlanVersion: vi.fn(async () => null),
    appendManualVersion: vi.fn(async () => ({ reportId: "30000000-0000-4000-8000-000000000003", version: 2 })),
    markConfirmed: vi.fn(async () => undefined),
    transaction: async (work) => work(repo),
    ...overrides,
  };
  return repo;
}

describe("creation service", () => {
  test("creates a compact validated creation request", async () => {
    const repo = repository();
    const result = await createCreationProject(actor, {
      contentType: "video", platform: "小红书", goal: "解释一个真实问题",
      requirements: "60 秒内", availableMinutes: 90,
    }, repo);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(repo.createProject).toHaveBeenCalledWith(actor, expect.objectContaining({ contentType: "video" }));
  });

  test("rejects material attachment outside an editable project", async () => {
    const repo = repository({ findProject: vi.fn(async () => ({ id: "20000000-0000-4000-8000-000000000002", status: "processing" as const, contentType: "video" as const })) });
    await expect(attachMaterials(actor, "20000000-0000-4000-8000-000000000002", [], repo)).rejects.toThrow("PROJECT_NOT_EDITABLE");
  });

  test("marks the project processing and enqueues one idempotent run", async () => {
    const repo = repository();
    const enqueue = vi.fn(async () => ({ aiRunId: "40000000-0000-4000-8000-000000000004", status: "processing" as const }));
    const result = await requestContentPlan(actor, {
      projectId: "20000000-0000-4000-8000-000000000002", idempotencyKey: "plan-1",
    }, { repository: repo, enqueue });
    expect(result.aiRunId).toBe("40000000-0000-4000-8000-000000000004");
    expect(repo.setProjectStatus).toHaveBeenCalledWith(actor, expect.any(String), "processing");
  });

  test("retries only the failed run from the same owned project with a stable key", async () => {
    const failedRunId = "40000000-0000-4000-8000-000000000004";
    const repo = repository({
      findRun: vi.fn(async () => ({ id: failedRunId, status: "failed" as const })),
    });
    const enqueue = vi.fn(async () => ({ aiRunId: "50000000-0000-4000-8000-000000000005" }));

    const result = await retryContentPlan(actor, {
      projectId: "20000000-0000-4000-8000-000000000002",
      failedRunId,
    }, { repository: repo, enqueue });

    expect(result.aiRunId).toBe("50000000-0000-4000-8000-000000000005");
    expect(enqueue).toHaveBeenCalledWith(actor, {
      taskType: "content_plan",
      entityId: "20000000-0000-4000-8000-000000000002",
      idempotencyKey: `retry:${failedRunId}`,
    });
  });

  test("rejects retrying an unrelated or non-failed content run", async () => {
    const repo = repository({
      findRun: vi.fn(async () => null),
    });

    await expect(retryContentPlan(actor, {
      projectId: "20000000-0000-4000-8000-000000000002",
      failedRunId: "40000000-0000-4000-8000-000000000004",
    }, { repository: repo, enqueue: vi.fn() })).rejects.toThrow("AI_RUN_NOT_RETRYABLE");
  });

  test("saves edits as a new immutable child version", async () => {
    const parent = {
      reportId: "30000000-0000-4000-8000-000000000003", version: 1, status: "ready" as const,
      generationMode: "ai" as const, contentType: "video" as const,
      content: { contentType: "video" as const, hooks: ["旧钩子"], storyboard: ["镜头"], voiceover: "口播", shootingSteps: [], riskNotes: [], tasks: [{ id: "50000000-0000-4000-8000-000000000005", title: "拍摄", reason: "验证", steps: ["拍摄"], completionCriteria: "成片", estimatedMinutes: 30, priority: 1 as const, plannedDate: "2026-08-09" }], citations: [] },
    };
    const repo = repository({ findPlanVersion: vi.fn(async () => parent) });
    const saved = await saveContentPlanVersion(actor, {
      reportId: parent.reportId, parentVersion: 1,
      content: { ...parent.content, hooks: ["新钩子"] },
    }, repo);
    expect(saved.version).toBe(2);
    expect(repo.appendManualVersion).toHaveBeenCalledWith(actor, expect.objectContaining({ parent, content: expect.objectContaining({ hooks: ["新钩子"] }) }));
  });
});
