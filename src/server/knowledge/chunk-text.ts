export const CHUNK_POLICY = {
  target: 600,
  min: 300,
  max: 800,
  overlap: 100,
} as const;

export type KnowledgeChunk = {
  index: number;
  charStart: number;
  charEnd: number;
  text: string;
};

const SENTENCE_END = /[。！？；.!?;：:]|\n/;

function isNaturalBoundary(text: string, end: number) {
  if (end <= 0 || end > text.length) return false;
  return SENTENCE_END.test(text[end - 1]);
}

function findChunkEnd(text: string, start: number) {
  const minimum = Math.min(text.length, start + CHUNK_POLICY.min);
  const target = Math.min(text.length, start + CHUNK_POLICY.target);
  const maximum = Math.min(text.length, start + CHUNK_POLICY.max);

  for (let end = target; end >= minimum; end -= 1) {
    if (isNaturalBoundary(text, end)) return end;
  }
  for (let end = target + 1; end <= maximum; end += 1) {
    if (isNaturalBoundary(text, end)) return end;
  }
  return maximum;
}

function normalizeSourceText(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function chunkKnowledgeText(sourceText: string): KnowledgeChunk[] {
  const text = normalizeSourceText(sourceText);
  if (!text) return [];
  if (text.length <= CHUNK_POLICY.max) {
    return [{ index: 0, charStart: 0, charEnd: text.length, text }];
  }

  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.length - start;
    let end = remaining <= CHUNK_POLICY.max ? text.length : findChunkEnd(text, start);

    if (
      end < text.length &&
      text.length - (end - CHUNK_POLICY.overlap) < CHUNK_POLICY.min
    ) {
      end = text.length - (CHUNK_POLICY.min - CHUNK_POLICY.overlap);
    }

    chunks.push({
      index: chunks.length,
      charStart: start,
      charEnd: end,
      text: text.slice(start, end),
    });
    if (end === text.length) break;
    start = end - CHUNK_POLICY.overlap;
  }
  return chunks;
}
