import { describe, expect, test } from "vitest";

import { CHUNK_POLICY, chunkKnowledgeText } from "./chunk-text";

describe("chunkKnowledgeText", () => {
  test("chunks Chinese paragraphs deterministically within the fixed policy", () => {
    const input = "第一段包含完整的信息。".repeat(90) + "\n\n" + "第二段继续解释结论。".repeat(90);
    const chunks = chunkKnowledgeText(input);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length >= 300 && chunk.text.length <= 800)).toBe(
      true,
    );
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    expect(chunkKnowledgeText(input)).toEqual(chunks);
  });

  test("uses exact 100-character overlap and source-relative offsets", () => {
    const input = "这是用于验证切片边界的中文句子。".repeat(100);
    const chunks = chunkKnowledgeText(input);

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1];
      const current = chunks[index];
      expect(current.charStart).toBe(previous.charEnd - CHUNK_POLICY.overlap);
      expect(current.text.slice(0, CHUNK_POLICY.overlap)).toBe(
        previous.text.slice(-CHUNK_POLICY.overlap),
      );
      expect(current.text).toBe(input.slice(current.charStart, current.charEnd));
    }
  });

  test("keeps a short document as one honest short chunk", () => {
    expect(chunkKnowledgeText("  简短资料。\r\n")).toEqual([
      { index: 0, charStart: 0, charEnd: 5, text: "简短资料。" },
    ]);
  });

  test("returns no chunks for blank input and never exceeds 800 characters", () => {
    expect(chunkKnowledgeText(" \n\t ")).toEqual([]);
    const chunks = chunkKnowledgeText("没有标点的连续文本".repeat(200));
    expect(chunks.every((chunk) => chunk.text.length <= CHUNK_POLICY.max)).toBe(true);
  });
});
