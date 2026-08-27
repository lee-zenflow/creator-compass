import type { KnowledgeChunk } from "./chunk-text";
import type { KnowledgeTags } from "./tag-knowledge";

type KnowledgeDefaults = {
  platform: string | null;
  contentType: string | null;
  tags: readonly string[];
};

function unique(values: readonly string[], limit: number) {
  return [...new Set(values.map((value) => value.normalize("NFKC").trim()).filter(Boolean))]
    .slice(0, limit);
}

function extractKeywords(text: string) {
  const candidates = text.normalize("NFKC").match(/[\p{Script=Han}]{2,8}|[a-zA-Z][a-zA-Z0-9-]{2,}/gu) ?? [];
  const frequencies = new Map<string, number>();
  for (const candidate of candidates) {
    frequencies.set(candidate, (frequencies.get(candidate) ?? 0) + 1);
  }
  return [...frequencies]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([keyword]) => keyword)
    .slice(0, 20);
}

export async function tagChunksLocally(
  chunks: readonly KnowledgeChunk[],
  defaults: KnowledgeDefaults,
) {
  const suppliedTags = unique(defaults.tags, 20);
  return chunks.map((chunk) => {
    const keywords = extractKeywords(chunk.text);
    const tags: KnowledgeTags = {
      summary: chunk.text.replace(/\s+/gu, " ").trim().slice(0, 240),
      normalizedKeywords: keywords,
      tags: suppliedTags.length > 0 ? suppliedTags : keywords.slice(0, 8),
      platform: defaults.platform,
      contentType: defaults.contentType,
    };
    return { chunk, tags };
  });
}
