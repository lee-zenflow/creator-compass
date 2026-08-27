import { describe, expect, test, vi } from "vitest";

import {
  FETCH_LIMITS,
  assertPublicAddress,
  safeFetchKnowledgeUrl,
  type SafeFetchDependencies,
  type SafeFetchResponse,
} from "./safe-fetch";
import { DOCX_MIME, knowledgeIngestionInputSchema } from "./ingestion-contracts";

function bodyFrom(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function publicDeps(
  response: Partial<Awaited<ReturnType<SafeFetchDependencies["requestOnce"]>>> = {},
): SafeFetchDependencies {
  return {
    resolveAll: vi.fn(async () => ["93.184.216.34"]),
    requestOnce: vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      body: bodyFrom("ok"),
      ...response,
    })),
  };
}

describe("knowledge ingestion input", () => {
  test("accepts only the supported 10 MiB file contract", () => {
    const base = {
      kind: "file" as const,
      name: "资料.docx",
      objectKey: "private/admin/example.docx",
      mime: DOCX_MIME,
      licenseNote: "已取得内部使用许可",
    };

    expect(
      knowledgeIngestionInputSchema.safeParse({ ...base, size: 10 * 1024 * 1024 }).success,
    ).toBe(true);
    expect(
      knowledgeIngestionInputSchema.safeParse({ ...base, size: 10 * 1024 * 1024 + 1 }).success,
    ).toBe(false);
    expect(
      knowledgeIngestionInputSchema.safeParse({ ...base, size: 1, mime: "application/msword" }).success,
    ).toBe(false);
  });
});

describe("safeFetchKnowledgeUrl", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
  ])("blocks non-public address %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow("URL_PRIVATE_ADDRESS");
  });

  test.each(["file:///etc/passwd", "ftp://example.com/file", "https://user:pass@example.com"])(
    "rejects unsafe URL %s",
    async (url) => {
      await expect(safeFetchKnowledgeUrl(url, publicDeps())).rejects.toThrow("URL_INVALID");
    },
  );

  test("blocks a hostname when any resolved address is private", async () => {
    const deps = publicDeps();
    deps.resolveAll = vi.fn(async () => ["93.184.216.34", "127.0.0.1"]);

    await expect(safeFetchKnowledgeUrl("https://example.com", deps)).rejects.toThrow(
      "URL_PRIVATE_ADDRESS",
    );
    expect(deps.requestOnce).not.toHaveBeenCalled();
  });

  test("binds the validated DNS addresses to the request", async () => {
    const deps = publicDeps();

    await safeFetchKnowledgeUrl("https://example.com/path", deps);

    expect(deps.requestOnce).toHaveBeenCalledWith(
      new URL("https://example.com/path"),
      ["93.184.216.34"],
      expect.any(AbortSignal),
    );
  });

  test("revalidates each redirect and allows at most three", async () => {
    let call = 0;
    const deps = publicDeps();
    deps.requestOnce = vi.fn(async () => {
      call += 1;
      if (call <= 3) {
        return {
          status: 302,
          headers: new Headers({ location: `https://redirect-${call}.example/next` }),
          body: null,
        };
      }
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        body: bodyFrom("done"),
      };
    });

    const result = await safeFetchKnowledgeUrl("https://example.com/start", deps);

    expect(new TextDecoder().decode(result.bytes)).toBe("done");
    expect(deps.resolveAll).toHaveBeenCalledTimes(4);
  });

  test("blocks a redirect when the next hostname resolves to metadata or a private address", async () => {
    const deps = publicDeps({
      status: 302,
      headers: new Headers({ location: "http://metadata.example/latest" }),
      body: null,
    });
    deps.resolveAll = vi.fn(async (hostname) => hostname === "metadata.example"
      ? ["169.254.169.254"]
      : ["93.184.216.34"]);

    await expect(safeFetchKnowledgeUrl("https://example.com/start", deps))
      .rejects.toThrow("URL_PRIVATE_ADDRESS");
    expect(deps.requestOnce).toHaveBeenCalledTimes(1);
  });

  test("rejects a fourth redirect", async () => {
    const deps = publicDeps({
      status: 302,
      headers: new Headers({ location: "/again" }),
      body: null,
    });

    await expect(safeFetchKnowledgeUrl("https://example.com/0", deps)).rejects.toThrow(
      "URL_TOO_MANY_REDIRECTS",
    );
    expect(deps.requestOnce).toHaveBeenCalledTimes(4);
  });

  test("rejects oversized content length before consuming the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const deps = publicDeps({
      headers: new Headers({
        "content-length": String(FETCH_LIMITS.maxBytes + 1),
        "content-type": "text/plain",
      }),
      body,
    });

    await expect(safeFetchKnowledgeUrl("https://example.com/large", deps)).rejects.toThrow(
      "URL_RESPONSE_TOO_LARGE",
    );
    expect(cancel).toHaveBeenCalled();
  });

  test("rejects a negative content length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const deps = publicDeps({
      headers: new Headers({
        "content-length": "-1",
        "content-type": "text/plain",
      }),
      body,
    });

    await expect(safeFetchKnowledgeUrl("https://example.com/invalid-length", deps)).rejects.toThrow(
      "URL_RESPONSE_TOO_LARGE",
    );
    expect(cancel).toHaveBeenCalled();
  });

  test.each([null, "application/json", "image/svg+xml"])(
    "rejects unsupported response MIME %s before consuming the body",
    async (contentType) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      const headers = new Headers();
      if (contentType) headers.set("content-type", contentType);
      const deps = publicDeps({ headers, body });

      await expect(safeFetchKnowledgeUrl("https://example.com/file", deps)).rejects.toThrow(
        "URL_UNSUPPORTED_CONTENT_TYPE",
      );
      expect(cancel).toHaveBeenCalled();
    },
  );

  test("accepts a supported response MIME with charset parameters", async () => {
    const deps = publicDeps({
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      body: bodyFrom("<p>ok</p>"),
    });

    await expect(safeFetchKnowledgeUrl("https://example.com/page", deps)).resolves.toMatchObject({
      status: 200,
    });
  });

  test("cancels a streaming response immediately after it exceeds 8 MiB", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(FETCH_LIMITS.maxBytes));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const deps = publicDeps({ body });

    await expect(safeFetchKnowledgeUrl("https://example.com/large", deps)).rejects.toThrow(
      "URL_RESPONSE_TOO_LARGE",
    );
    expect(cancel).toHaveBeenCalled();
  });

  test("aborts a request after 15 seconds", async () => {
    vi.useFakeTimers();
    const deps = publicDeps();
    deps.requestOnce = vi.fn(
      (_url, _addresses, signal): Promise<SafeFetchResponse> =>
        new Promise<SafeFetchResponse>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    const result = expect(
      safeFetchKnowledgeUrl("https://example.com/slow", deps),
    ).rejects.toThrow("URL_TIMEOUT");
    await vi.advanceTimersByTimeAsync(FETCH_LIMITS.timeoutMs);

    await result;
    vi.useRealTimers();
  });

  test("times out even when DNS resolution never returns", async () => {
    vi.useFakeTimers();
    const deps = publicDeps();
    deps.resolveAll = vi.fn(() => new Promise<string[]>(() => undefined));

    const result = expect(
      safeFetchKnowledgeUrl("https://example.com/slow-dns", deps),
    ).rejects.toThrow("URL_TIMEOUT");
    await vi.advanceTimersByTimeAsync(FETCH_LIMITS.timeoutMs);

    await result;
    expect(deps.requestOnce).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("uses one total timeout budget across redirects", async () => {
    vi.useFakeTimers();
    const deps = publicDeps();
    deps.requestOnce = vi.fn((_url, _addresses, signal) =>
      new Promise<SafeFetchResponse>((resolve, reject) => {
        const timer = setTimeout(() => resolve({
          status: 302,
          headers: new Headers({ location: "/next" }),
          body: null,
        }), 8_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      }));

    const result = expect(safeFetchKnowledgeUrl("https://example.com/start", deps))
      .rejects.toThrow("URL_TIMEOUT");
    await vi.advanceTimersByTimeAsync(FETCH_LIMITS.timeoutMs);
    await result;
    expect(deps.requestOnce).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
