import { describe, expect, test } from "vitest";

import type { KnowledgeCandidate } from "./retrieve-knowledge";
import { explainCandidate, explainKnowledgeRetrieval } from "./retrieval-explanation";

const input = {
  platform: "douyin",
  contentType: "video",
  tags: ["效率"],
  keywords: ["复盘"],
};

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    kind: "knowledge",
    id: "item-1",
    sourceId: "source-1",
    sourceName: "真实来源",
    publicUrl: "https://example.com",
    sourceReviewStatus: "approved",
    sourceRetrievalScope: "production",
    sourceIsDemo: false,
    sourceAllowAiSend: true,
    platform: "douyin",
    contentType: "video",
    tags: ["效率"],
    title: "效率复盘",
    body: "一次真实的效率复盘方法",
    itemReviewStatus: "approved",
    itemRetrievalScope: "production",
    itemIsDemo: false,
    enabled: true,
    validFrom: null,
    validUntil: null,
    version: 1,
    contentHash: "hash",
    databaseRank: 0.4,
    embedding: null,
    ...overrides,
  };
}

describe("explainCandidate", () => {
  test("returns deterministic score contributions", () => {
    const result = explainCandidate(candidate(), input, new Date("2026-08-13"));

    expect(result.accepted).toBe(true);
    expect(result.signals).toEqual(expect.arrayContaining([
      { kind: "exact_tag", value: "效率", contribution: 5 },
      { kind: "database_rank", contribution: 40 },
    ]));
    expect(result.totalScore).toBe(
      result.signals.reduce((sum, signal) => sum + signal.contribution, 0),
    );
  });

  test("returns a stable rejection reason without score details", () => {
    const result = explainCandidate(candidate({ enabled: false }), input);
    expect(result).toMatchObject({ accepted: false, signals: [], totalScore: 0 });
    expect(result.reasons).toContain("ITEM_DISABLED");
  });

  test("returns top hits, source diversity, and filtered counts for admin inspection", async () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => candidate({
        id: `same-${index}`,
        sourceId: "same-source",
        sourceName: "同一来源",
        contentHash: `same-${index}`,
      })),
      candidate({ id: "other", sourceId: "other-source", sourceName: "另一来源" }),
      candidate({ id: "pending", itemReviewStatus: "pending" }),
    ];
    const result = await explainKnowledgeRetrieval(input, {
      limit: 200,
      async findInspectionCandidates() { return candidates; },
    });

    expect(result.hits.filter((hit) => hit.sourceName === "同一来源")).toHaveLength(3);
    expect(result.reasonCounts.ITEM_NOT_APPROVED).toBe(1);
    expect(result.candidateCount).toBe(7);
    expect(result.acceptedCandidateCount).toBe(6);
    expect(result.excludedCandidateCount).toBe(1);
    expect(result.hits[0]?.signals.length).toBeGreaterThan(0);
  });

  test("returns a bounded sanitized admin read model and counts excluded candidates once", async () => {
    const candidates = [
      candidate({ id: "accepted", body: "正".repeat(500), contentHash: "private-hash" }),
      candidate({ id: "rejected", itemReviewStatus: "pending", enabled: false }),
    ];

    const result = await explainKnowledgeRetrieval(input, {
      limit: 200,
      async findInspectionCandidates() { return candidates; },
    });

    expect(result).toMatchObject({
      candidateCount: 2,
      acceptedCandidateCount: 1,
      excludedCandidateCount: 1,
      inspectionLimit: 200,
      reasonCounts: { ITEM_NOT_APPROVED: 1, ITEM_DISABLED: 1 },
    });
    expect(result.hits[0]?.excerpt).toHaveLength(360);
    expect(result.hits[0]).not.toHaveProperty("body");
    expect(result.hits[0]).not.toHaveProperty("contentHash");
    expect(result.hits[0]).not.toHaveProperty("id");
    expect(result.hits[0]).not.toHaveProperty("sourceId");
  });
});
