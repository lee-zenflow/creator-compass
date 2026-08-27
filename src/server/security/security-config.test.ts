import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import nextConfig from "../../../next.config";

describe("PWA security configuration", () => {
  test("sets browser hardening headers on every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const entries = await nextConfig.headers!();
    const headers = Object.fromEntries(entries[0]!.headers.map((header) => [header.key.toLowerCase(), header.value]));
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toContain("strict-origin");
  });

  test("service worker never caches API or document responses", async () => {
    const source = await readFile(join(process.cwd(), "public", "sw.js"), "utf8");
    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).toContain("request.destination");
    expect(source).not.toContain("caches.match(request) || fetch(request)");
  });
});
