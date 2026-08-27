import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

import { SUPPORTED_KNOWLEDGE_MIMES } from "./ingestion-contracts";

export const FETCH_LIMITS = {
  timeoutMs: 15_000,
  maxRedirects: 3,
  maxBytes: 8 * 1024 * 1024,
} as const;

export type SafeFetchResponse = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  close?: () => Promise<void> | void;
};

export type SafeFetchDependencies = {
  resolveAll(hostname: string): Promise<string[]>;
  requestOnce(
    url: URL,
    validatedAddresses: string[],
    signal: AbortSignal,
  ): Promise<SafeFetchResponse>;
};

export type SafeFetchResult = {
  url: URL;
  status: number;
  headers: Headers;
  bytes: Uint8Array;
};

function failure(code: string) {
  return new Error(code);
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function assertPublicAddress(address: string) {
  let range: string;
  try {
    range = ipaddr.process(address).range();
  } catch {
    throw failure("URL_PRIVATE_ADDRESS");
  }
  if (range !== "unicast") throw failure("URL_PRIVATE_ADDRESS");
}

function parseSafeUrl(value: string | URL) {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw failure("URL_INVALID");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw failure("URL_INVALID");
  }
  if (url.username || url.password || !url.hostname) throw failure("URL_INVALID");
  return url;
}

async function defaultResolveAll(hostname: string) {
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  return resolved.map((entry) => entry.address);
}

function selectBoundAddress(addresses: string[], family?: number) {
  const matching = addresses.find((address) => {
    if (family !== 4 && family !== 6) return true;
    return ipaddr.parse(address).kind() === `ipv${family}`;
  });
  return matching ?? addresses[0];
}

async function defaultRequestOnce(
  url: URL,
  validatedAddresses: string[],
  signal: AbortSignal,
): Promise<SafeFetchResponse> {
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const requestedFamily = typeof options === "number" ? options : options.family;
        const family = requestedFamily === "IPv4"
          ? 4
          : requestedFamily === "IPv6"
            ? 6
            : requestedFamily;
        const address = selectBoundAddress(validatedAddresses, family);
        if (!address) {
          callback(new Error("URL_DNS_EMPTY"), "", 4);
          return;
        }
        callback(null, address, ipaddr.parse(address).kind() === "ipv6" ? 6 : 4);
      },
    },
  });

  try {
    const response = await undiciFetch(url, {
      dispatcher,
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "user-agent": "CreatorCompassKnowledgeFetcher/1.0",
      },
    });
    const headers = new Headers();
    response.headers.forEach((headerValue, headerName) => {
      headers.append(headerName, headerValue);
    });
    const sourceBody = response.body;
    const sourceReader = sourceBody?.getReader();
    const body = sourceReader
      ? new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await sourceReader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(value));
          },
          async cancel(reason) {
            await sourceReader.cancel(reason);
          },
        })
      : null;
    return {
      status: response.status,
      headers,
      body,
      close: () => dispatcher.close(),
    };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

const defaultDependencies: SafeFetchDependencies = {
  resolveAll: defaultResolveAll,
  requestOnce: defaultRequestOnce,
};

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // The connection can already be closed by an aborted request.
  }
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > FETCH_LIMITS.maxBytes) {
        await reader.cancel();
        throw failure("URL_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function safeFetchKnowledgeUrl(
  value: string | URL,
  dependencies: SafeFetchDependencies = defaultDependencies,
): Promise<SafeFetchResult> {
  let currentUrl = parseSafeUrl(value);
  let redirects = 0;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(failure("URL_TIMEOUT")),
    FETCH_LIMITS.timeoutMs,
  );

  try {
    while (true) {
      const addresses = await waitWithAbort(
        dependencies.resolveAll(currentUrl.hostname),
        controller.signal,
      );
      if (addresses.length === 0) throw failure("URL_DNS_EMPTY");
      addresses.forEach(assertPublicAddress);

      const response = await waitWithAbort(
        dependencies.requestOnce(currentUrl, addresses, controller.signal),
        controller.signal,
      );
      try {
        if (response.status >= 300 && response.status < 400) {
          await cancelBody(response.body);
          if (redirects >= FETCH_LIMITS.maxRedirects) {
            throw failure("URL_TOO_MANY_REDIRECTS");
          }
          const location = response.headers.get("location");
          if (!location) throw failure("URL_REDIRECT_INVALID");
          currentUrl = parseSafeUrl(new URL(location, currentUrl));
          redirects += 1;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          await cancelBody(response.body);
          throw failure("URL_HTTP_ERROR");
        }

        const contentType = response.headers.get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLocaleLowerCase("en-US");
        if (
          !contentType ||
          !SUPPORTED_KNOWLEDGE_MIMES.some((supportedMime) => supportedMime === contentType)
        ) {
          await cancelBody(response.body);
          throw failure("URL_UNSUPPORTED_CONTENT_TYPE");
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength !== null) {
          const declaredBytes = Number(contentLength);
          if (
            !Number.isSafeInteger(declaredBytes) ||
            declaredBytes < 0 ||
            declaredBytes > FETCH_LIMITS.maxBytes
          ) {
            await cancelBody(response.body);
            throw failure("URL_RESPONSE_TOO_LARGE");
          }
        }

        return {
          url: currentUrl,
          status: response.status,
          headers: response.headers,
          bytes: await waitWithAbort(readBoundedBody(response.body), controller.signal),
        };
      } finally {
        await response.close?.();
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw failure("URL_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
