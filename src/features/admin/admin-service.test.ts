import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  activatePromptVersion,
  buildSourceQuality,
  getKnowledgeOverview,
  getKnowledgeSourceDetail,
  listFailedAiRuns,
  listKnowledgeSources,
  type AdminKnowledgeSource,
  type AdminKnowledgeSourceDetail,
  type AdminRepository,
} from "./admin-service";

const sourceFixture: AdminKnowledgeSource = {
  id: "30000000-0000-4000-8000-000000000003",
  name: "公开案例",
  sourceType: "public_web",
  fetchStatus: "fetched",
  reviewStatus: "pending",
  retrievalScope: "development_only",
  createdAt: new Date("2026-08-11T00:00:00Z"),
  processedAt: new Date("2026-08-11T00:01:00Z"),
  failureCode: null,
  jobStatus: "pending_review",
  itemCount: 2,
  pendingItemCount: 2,
};

const detailFixture: AdminKnowledgeSourceDetail = {
  source: {
    id: sourceFixture.id,
    name: "公开案例",
    publicUrl: "https://example.com/case",
    sourceType: "public_web",
    originalMime: "text/html",
    fetchStatus: "fetched",
    licenseNote: "公开页面，仅用于案例分析",
    failureCode: null,
    reviewStatus: "pending",
    retrievalScope: "development_only",
    createdAt: new Date("2026-08-11T00:00:00Z"),
    processedAt: new Date("2026-08-11T00:01:00Z"),
    allowAiSend: false,
    embeddingStatus: "ready",
    defaultPlatform: "xiaohongshu",
    defaultContentType: "note",
    defaultTags: ["定位"],
  },
  job: { status: "pending_review", failureCode: null },
  reviewHistory: [],
  itemReviewHistory: [],
  itemWindow: { shown: 0, total: 0, limit: 500 },
  quality: {
    characters: 0,
    chunks: 0,
    averageChunkLength: 0,
    blank: 0,
    short: 0,
    long: 0,
    duplicate: 0,
    missingMetadata: 0,
  },
  reviewProgress: { reviewed: 0, total: 0 },
  items: [],
};

const repository: AdminRepository = {
  listFailedAiRuns: vi.fn(async () => []),
  listKnowledgeSources: vi.fn(async (options) => ({
    rows: [sourceFixture],
    total: options.reviewOnly ? 1 : 101,
    hasMore: !options.reviewOnly,
    limit: options.limit,
    reviewOnly: options.reviewOnly,
  })),
  getKnowledgeSourceDetail: vi.fn(async () => detailFixture),
  getKnowledgeOverviewCounts: vi.fn(async () => ({
    sources: 101,
    pendingSources: 17,
    failedSources: 3,
    chunks: 1200,
    pendingChunks: 88,
  })),
  listRules: vi.fn(async () => []),
  listPrompts: vi.fn(async () => []),
  activatePromptVersion: vi.fn(async (promptId) => ({ id: promptId, enabled: true })),
};

describe("admin boundary", () => {
  test("ordinary users cannot open admin services", async () => {
    const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
    await expect(listFailedAiRuns(actor, repository)).rejects.toThrow("FORBIDDEN");
  });

  test("guests cannot open admin services", async () => {
    const actor: CurrentActor = { kind: "guest", guestSessionId: "20000000-0000-4000-8000-000000000002" };
    await expect(listFailedAiRuns(actor, repository)).rejects.toThrow("FORBIDDEN");
  });

  test("lists only sanitized source operations data", async () => {
    const admin: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "admin" };
    const sources = await listKnowledgeSources(admin, { reviewOnly: true }, repository);
    expect(sources).toMatchObject({ total: 1, hasMore: false, reviewOnly: true });
    expect(sources.rows).toHaveLength(1);
    expect(sources.rows[0]).not.toHaveProperty("objectKey");
    expect(sources.rows[0]).not.toHaveProperty("searchableText");
    const detail = await getKnowledgeSourceDetail(admin, sourceFixture.id, repository);
    expect(detail?.source).not.toHaveProperty("objectKey");
    expect(detail?.job).not.toHaveProperty("safeFailureDetail");
  });

  test("source detail and prompt activation remain admin-only", async () => {
    const user: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
    await expect(getKnowledgeSourceDetail(user, "30000000-0000-4000-8000-000000000003", repository)).rejects.toThrow("FORBIDDEN");
    await expect(activatePromptVersion(user, "prompt-1", repository)).rejects.toThrow("FORBIDDEN");
  });

  test("computes overview counts from real source states", async () => {
    const admin: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "admin" };
    await expect(getKnowledgeOverview(admin, repository)).resolves.toEqual({
      sources: 101,
      pendingSources: 17,
      failedSources: 3,
      chunks: 1200,
      pendingChunks: 88,
    });
  });

  test("returns source quality and review progress without exposing full text", async () => {
    const admin: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "admin" };
    const detail = await getKnowledgeSourceDetail(admin, sourceFixture.id, repository);
    expect(detail?.quality).toEqual(expect.objectContaining({ characters: 0, chunks: 0 }));
    expect(detail?.reviewProgress).toEqual({ reviewed: 0, total: 0 });
    expect(detail?.items.every((item) => !("searchableText" in item))).toBe(true);
    expect(buildSourceQuality([
      { characterCount: 40, contentHash: "same", platform: null, contentType: "note", tags: [], reviewStatus: "pending" },
      { characterCount: 900, contentHash: "same", platform: "xiaohongshu", contentType: "note", tags: ["定位"], reviewStatus: "approved" },
    ])).toEqual({
      characters: 940,
      chunks: 2,
      averageChunkLength: 470,
      blank: 0,
      short: 1,
      long: 1,
      duplicate: 2,
      missingMetadata: 1,
      reviewed: 1,
    });
  });
});
