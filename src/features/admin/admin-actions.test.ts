import { beforeEach, describe, expect, test, vi } from "vitest";

const actor = {
  kind: "user" as const,
  userId: "10000000-0000-4000-8000-000000000001",
  role: "admin" as const,
};
const sourceId = "30000000-0000-4000-8000-000000000003";
const itemId = "40000000-0000-4000-8000-000000000004";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  reviewSource: vi.fn(),
  reviewItem: vi.fn(),
  setEnabled: vi.fn(),
  retrieve: vi.fn(),
  activatePrompt: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})), headers: vi.fn(async () => ({})) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: vi.fn(async () => actor) }));
vi.mock("@/server/knowledge/ingestion-service", () => ({
  enqueueKnowledgeIngestion: mocks.enqueue,
  reviewKnowledgeSource: mocks.reviewSource,
  reviewKnowledgeItem: mocks.reviewItem,
  setKnowledgeItemEnabled: mocks.setEnabled,
}));
vi.mock("./admin-service", () => ({
  activatePromptVersion: mocks.activatePrompt,
  testKnowledgeRetrieval: mocks.retrieve,
}));

import {
  importKnowledgeAction,
  reviewKnowledgeChunkAction,
  reviewKnowledgeSourceAction,
  setKnowledgeChunkEnabledAction,
  testKnowledgeRetrievalAction,
} from "./admin-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("knowledge admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueue.mockResolvedValue({ sourceId: "source-1", jobId: "job-1" });
    mocks.reviewSource.mockResolvedValue({ id: "source-1" });
    mocks.reviewItem.mockResolvedValue({ id: "item-1" });
    mocks.setEnabled.mockResolvedValue({ id: "item-1" });
    mocks.retrieve.mockResolvedValue({
      hits: [],
      reasonCounts: {},
      candidateCount: 0,
      acceptedCandidateCount: 0,
      excludedCandidateCount: 0,
      inspectionLimit: 200,
    });
  });

  test("queues URL knowledge as pending governed ingestion", async () => {
    await importKnowledgeAction(form({
      kind: "url",
      name: "平台规则",
      url: "https://example.com/rules",
      licenseNote: "公开规则页面",
      platform: "xiaohongshu",
      contentType: "note",
      tags: "定位,选题",
    }));
    expect(mocks.enqueue).toHaveBeenCalledWith(actor, {
      kind: "url",
      name: "平台规则",
      url: "https://example.com/rules",
      licenseNote: "公开规则页面",
      platform: "xiaohongshu",
      contentType: "note",
      tags: ["定位", "选题"],
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/knowledge?notice=queued");
  });

  test("keeps source and chunk review as separate operations", async () => {
    await reviewKnowledgeSourceAction(form({ sourceId, reviewStatus: "approved", allowAiSend: "true" }));
    await reviewKnowledgeChunkAction(form({ sourceId, itemId, reviewStatus: "approved", reviewNote: "内容可用" }));
    expect(mocks.reviewSource).toHaveBeenCalledWith(actor, sourceId, "approved", null, true);
    expect(mocks.reviewItem).toHaveBeenCalledWith(actor, itemId, "approved", "内容可用");
  });

  test("passes a source rejection reason to the governed review service", async () => {
    await reviewKnowledgeSourceAction(form({
      sourceId,
      reviewStatus: "rejected",
      reviewNote: "授权范围无法确认",
    }));

    expect(mocks.reviewSource).toHaveBeenCalledWith(actor, sourceId, "rejected", "授权范围无法确认", false);
  });

  test("can disable an approved chunk without deleting it", async () => {
    await setKnowledgeChunkEnabledAction(form({ sourceId, itemId, enabled: "false" }));
    expect(mocks.setEnabled).toHaveBeenCalledWith(actor, itemId, false);
  });

  test("returns only actual retrieval hits", async () => {
    mocks.retrieve.mockResolvedValue({
      hits: [{ kind: "knowledge", sourceName: "真实来源", title: "真实命中", excerpt: "受限预览", version: 1, score: 30, matchMode: "deterministic_text", signals: [] }],
      reasonCounts: {},
      candidateCount: 1,
      acceptedCandidateCount: 1,
      excludedCandidateCount: 0,
      inspectionLimit: 200,
    });
    await expect(testKnowledgeRetrievalAction(form({
      platform: "xiaohongshu",
      contentType: "note",
      tags: "个人IP,定位",
      keywords: "个人IP定位",
    }))).resolves.toEqual({
      ok: true,
      hits: [{ kind: "knowledge", sourceName: "真实来源", title: "真实命中", excerpt: "受限预览", version: 1, score: 30, matchMode: "deterministic_text", signals: [] }],
      reasonCounts: {},
      candidateCount: 1,
      acceptedCandidateCount: 1,
      excludedCandidateCount: 0,
      inspectionLimit: 200,
    });
    expect(mocks.retrieve).toHaveBeenCalledWith(actor, {
      platform: "xiaohongshu",
      contentType: "note",
      tags: ["个人IP", "定位"],
      keywords: ["个人IP定位"],
    });
  });
});
