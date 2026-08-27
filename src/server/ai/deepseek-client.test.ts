import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { AiFailure, DeepSeekClient, DEEPSEEK_ENDPOINT } from "./deepseek-client";

const outputSchema = z
  .object({
    title: z.string().min(1).max(120),
    sourceIds: z.array(z.string()).max(8),
  })
  .strict();

function response(
  content: string,
  status = 200,
  usage = { prompt_tokens: 12, completion_tokens: 4 },
) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("DeepSeekClient", () => {
  test("fails before fetch when the server-only API configuration is missing", async () => {
    const fetcher = vi.fn();
    const client = new DeepSeekClient({ apiKey: "", fetcher });

    await expect(
      client.generateJson({ schema: outputSchema, system: "system", user: "user" }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("uses the fixed v4-flash model, JSON mode, no tools, and reports token usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(response('{"title":"结果","sourceIds":[]}'));
    const onUsage = vi.fn();
    const client = new DeepSeekClient({ apiKey: "secret", fetcher, onUsage });

    const result = await client.generateJson({
      schema: outputSchema,
      system: "trusted system",
      user: "untrusted user data",
    });

    expect(result.title).toBe("结果");
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_ENDPOINT);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "deepseek-v4-flash", response_format: { type: "json_object" } });
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0].content).toContain("trusted system");
    expect(body.messages[0].content).toContain("title");
    expect(body.messages[0].content).toContain("sourceIds");
    expect(String(init.headers && new Headers(init.headers).get("authorization"))).toBe("Bearer secret");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 4 });
  });

  test("stops after one request when DeepSeek returns invalid JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("not-json"));
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    await expect(
      client.generateJson({
        schema: outputSchema,
        system: "trusted system",
        user: "untrusted user data",
        sourceIdAllowlist: ["source-1"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("does not multiply queue retries for network errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("private upstream detail"));
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    await expect(
      client.generateJson({ schema: outputSchema, system: "system", user: "user" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("does not start a request when worker shutdown already aborted the signal", async () => {
    const fetcher = vi.fn().mockResolvedValue(response('{"title":"结果","sourceIds":[]}'));
    const controller = new AbortController();
    controller.abort();
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    await expect(
      client.generateJson({
        schema: outputSchema,
        system: "system",
        user: "user",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("treats a malformed success envelope as terminal invalid output", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    await expect(
      client.generateJson({ schema: outputSchema, system: "system", user: "user" }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([
    [401, "UPSTREAM_ERROR", false],
    [403, "UPSTREAM_ERROR", false],
    [422, "UPSTREAM_ERROR", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_ERROR", true],
  ] as const)("classifies HTTP %s without exposing upstream content", async (status, code, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("private upstream body", { status }),
    );
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    let caught: unknown;
    try {
      await client.generateJson({ schema: outputSchema, system: "system", user: "user" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiFailure);
    expect(caught).toMatchObject({ code, retryable });
    expect((caught as Error).message).not.toContain("private upstream body");
  });

  test("rejects extra output keys and citations outside the retrieval allowlist", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response('{"title":"结果","sourceIds":["forged"],"extra":true}'));
    const client = new DeepSeekClient({ apiKey: "secret", fetcher });

    await expect(
      client.generateJson({
        schema: outputSchema,
        system: "system",
        user: "user",
        sourceIdAllowlist: ["source-1"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
