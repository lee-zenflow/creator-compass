import { describe, expect, test, vi } from "vitest";

import { resolveRunCitations, type CitationRepository } from "./citation-service";

const actor = { kind: "user" as const, userId: "10000000-0000-4000-8000-000000000001", role: "user" as const };
const hit = (pair: { itemId: string; sourceId: string }, selected = true) => ({
  ...pair, itemVersion: 1, contentHash: "hash", rank: 1, score: 1, selected,
});

describe("resolveRunCitations", () => {
  test("only resolves exact item and source pairs from the actor snapshot", async () => {
    const itemId = "30000000-0000-4000-8000-000000000003";
    const sourceId = "40000000-0000-4000-8000-000000000004";
    const repository: CitationRepository = {
      getActorSnapshot: async () => [hit({ itemId, sourceId })],
      resolvePairs: async (pairs) => pairs.map((pair) => ({
        ...pair,
        title: "真实资料",
        sourceName: "公开来源",
        sourceType: "public_web",
        summary: "已审核摘要",
        reviewedAt: new Date("2026-08-13"),
        publicUrl: "https://example.com",
      })),
    };

    await expect(resolveRunCitations(actor, "20000000-0000-4000-8000-000000000002", [
      { itemId, sourceId },
      { itemId: "50000000-0000-4000-8000-000000000005", sourceId },
    ], repository)).resolves.toEqual([expect.objectContaining({ itemId, title: "真实资料" })]);
  });

  test("deduplicates exact pairs while preserving report order despite repository order", async () => {
    const first = { itemId: "30000000-0000-4000-8000-000000000003", sourceId: "40000000-0000-4000-8000-000000000004" };
    const second = { itemId: "50000000-0000-4000-8000-000000000005", sourceId: "60000000-0000-4000-8000-000000000006" };
    const view = (pair: typeof first, title: string) => ({ ...pair, title, sourceName: "已审核来源", sourceType: "public_web", summary: "摘要", reviewedAt: new Date("2026-08-13"), publicUrl: null });
    const repository: CitationRepository = {
      getActorSnapshot: async () => [hit(first), { ...hit(second), rank: 2 }],
      resolvePairs: async () => [view(second, "第二条"), view(first, "第一条")],
    };

    const result = await resolveRunCitations(actor, "20000000-0000-4000-8000-000000000002", [first, second, first], repository);
    expect(result.map((item) => item.title)).toEqual(["第一条", "第二条"]);
  });

  test("rejects malformed ids before repository access", async () => {
    const repository: CitationRepository = {
      getActorSnapshot: vi.fn(async () => []),
      resolvePairs: vi.fn(async () => []),
    };
    await expect(resolveRunCitations(actor, "not-a-uuid", [], repository)).rejects.toThrow();
    await expect(resolveRunCitations(actor, "20000000-0000-4000-8000-000000000002", [{ itemId: "bad", sourceId: "also-bad" }], repository)).rejects.toThrow();
    expect(repository.getActorSnapshot).not.toHaveBeenCalled();
  });

  test("rejects malformed snapshot rows before resolution", async () => {
    const resolvePairs = vi.fn(async () => []);
    const repository: CitationRepository = {
      getActorSnapshot: async () => [{ itemId: "bad", sourceId: "bad", selected: "yes" }],
      resolvePairs,
    };
    await expect(resolveRunCitations(actor, "20000000-0000-4000-8000-000000000002", [], repository)).rejects.toThrow();
    expect(resolvePairs).not.toHaveBeenCalled();
  });

  test("rejects a retrieval record that does not belong to the actor", async () => {
    const repository: CitationRepository = {
      getActorSnapshot: async () => null,
      resolvePairs: async () => [],
    };
    await expect(resolveRunCitations(actor, "20000000-0000-4000-8000-000000000002", [], repository)).rejects.toThrow("NOT_FOUND");
  });
});
