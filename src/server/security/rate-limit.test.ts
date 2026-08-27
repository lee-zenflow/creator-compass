import { describe, expect, test } from "vitest";

import { InMemoryRateLimiter, shouldBypassRateLimitsForE2e } from "./rate-limit";

describe("endpoint rate limits", () => {
  test("rejects calls beyond the scope limit until the window resets", () => {
    const limiter = new InMemoryRateLimiter();
    limiter.consume("export:user-1", { limit: 2, windowMs: 1_000 }, 10_000);
    limiter.consume("export:user-1", { limit: 2, windowMs: 1_000 }, 10_001);
    expect(() => limiter.consume("export:user-1", { limit: 2, windowMs: 1_000 }, 10_002)).toThrow("RATE_LIMITED");
    expect(() => limiter.consume("export:user-1", { limit: 2, windowMs: 1_000 }, 11_001)).not.toThrow();
  });

  test("only bypasses limits for an explicit isolated local E2E runtime", () => {
    expect(shouldBypassRateLimitsForE2e({
      E2E_RATE_LIMIT_BYPASS: "1",
      DATABASE_URL: "postgresql://tester:secret@127.0.0.1:5432/creator_compass_e2e",
      AI_ADAPTER: "test",
      LOCAL_RUNTIME_MODE: "1",
    })).toBe(true);
    expect(shouldBypassRateLimitsForE2e({
      E2E_RATE_LIMIT_BYPASS: "1",
      DATABASE_URL: "postgresql://tester:secret@127.0.0.1:5432/creator_compass",
      AI_ADAPTER: "test",
      LOCAL_RUNTIME_MODE: "1",
    })).toBe(false);
  });
});
