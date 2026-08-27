export type FusedRank = {
  id: string;
  score: number;
  lexicalRank: number | null;
  semanticRank: number | null;
};

type RankFusionInput = {
  lexical: readonly string[];
  semantic: readonly string[];
  rankConstant?: number;
};

function uniqueRanks(ids: readonly string[]) {
  const ranks = new Map<string, number>();
  for (const id of ids) {
    if (id && !ranks.has(id)) ranks.set(id, ranks.size + 1);
  }
  return ranks;
}

export function reciprocalRankFusion({
  lexical,
  semantic,
  rankConstant = 60,
}: RankFusionInput): FusedRank[] {
  if (!Number.isFinite(rankConstant) || rankConstant < 0) {
    throw new Error("INVALID_RANK_CONSTANT");
  }
  const lexicalRanks = uniqueRanks(lexical);
  const semanticRanks = uniqueRanks(semantic);
  const ids = new Set([...lexicalRanks.keys(), ...semanticRanks.keys()]);
  return [...ids].map((id) => {
    const lexicalRank = lexicalRanks.get(id) ?? null;
    const semanticRank = semanticRanks.get(id) ?? null;
    return {
      id,
      lexicalRank,
      semanticRank,
      score:
        (lexicalRank === null ? 0 : 1 / (rankConstant + lexicalRank)) +
        (semanticRank === null ? 0 : 1 / (rankConstant + semanticRank)),
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
