import { describe, expect, test, vi } from "vitest";

import { EmbeddingClient, EmbeddingFailure } from "./embedding-client";

function vector(value = 1) {
  return Array.from({ length: 512 }, () => value);
}

describe("EmbeddingClient", () => {
  test("normalizes document vectors returned by the local service", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "BAAI/bge-small-zh-v1.5",
      version: "1",
      dimensions: 512,
      vectors: [vector(2), vector(3)],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new EmbeddingClient({ fetchImpl });

    const result = await client.embedDocuments(["个人 IP 定位", "内容复盘"]);

    expect(result.model).toBe("BAAI/bge-small-zh-v1.5");
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(512);
    expect(Math.hypot(...result.vectors[0]!)).toBeCloseTo(1, 6);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/embed",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  test("uses the query endpoint contract and rejects blank text", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "BAAI/bge-small-zh-v1.5",
      version: "1",
      dimensions: 512,
      vectors: [vector()],
    }), { status: 200 }));
    const client = new EmbeddingClient({ fetchImpl });

    await expect(client.embedQuery("  ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await client.embedQuery("考试周效率工具");
    const request = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body))).toEqual({
      mode: "query",
      texts: ["考试周效率工具"],
    });
  });

  test("classifies an unreachable local model as an explicit unavailable failure", async () => {
    const client = new EmbeddingClient({
      fetchImpl: vi.fn(async () => { throw new TypeError("connect refused"); }),
    });

    await expect(client.embedQuery("个人 IP 定位")).rejects.toEqual(
      expect.objectContaining({ code: "EMBEDDING_UNAVAILABLE", retryable: true }),
    );
  });

  test("rejects wrong dimensions and non-finite values without leaking the response", async () => {
    const invalidResponses = [
      { model: "bad", version: "1", dimensions: 3, vectors: [[1, 2, 3]] },
      { model: "bad", version: "1", dimensions: 512, vectors: [vector(Number.NaN)] },
    ];
    for (const payload of invalidResponses) {
      const client = new EmbeddingClient({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
      });
      await expect(client.embedQuery("测试")).rejects.toBeInstanceOf(EmbeddingFailure);
      await expect(client.embedQuery("测试")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
});
