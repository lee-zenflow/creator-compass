import { describe, expect, test } from "vitest";

import { reciprocalRankFusion } from "./rank-fusion";

describe("reciprocalRankFusion", () => {
  test("rewards candidates supported by both lexical and vector rankings", () => {
    const result = reciprocalRankFusion({
      lexical: ["lexical-only", "shared", "tail"],
      semantic: ["semantic-only", "shared", "tail"],
    });

    expect(result[0]?.id).toBe("shared");
    expect(result.find((item) => item.id === "shared")).toMatchObject({
      lexicalRank: 2,
      semanticRank: 2,
    });
  });

  test("deduplicates ids and produces deterministic ties", () => {
    const result = reciprocalRankFusion({
      lexical: ["b", "b", "a"],
      semantic: [],
      rankConstant: 0,
    });

    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
  });

  test("supports semantic-only results", () => {
    expect(reciprocalRankFusion({ lexical: [], semantic: ["s1", "s2"] }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "s1", lexicalRank: null, semanticRank: 1 }),
      ]));
  });
});
