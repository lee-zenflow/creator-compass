import { createHmac } from "node:crypto";

import { assertIsolatedE2eDatabaseUrl } from "@/server/release/e2e-isolation";

export type RateLimitScope = "guest" | "auth" | "ai" | "ocr-confirm" | "upload" | "export" | "backup";
export type RateLimitPolicy = { limit: number; windowMs: number };

export const RATE_LIMIT_POLICIES: Record<RateLimitScope, RateLimitPolicy> = {
  guest: { limit: 20, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  ai: { limit: 5, windowMs: 60_000 },
  "ocr-confirm": { limit: 20, windowMs: 60_000 },
  upload: { limit: 10, windowMs: 60_000 },
  export: { limit: 3, windowMs: 60 * 60_000 },
  backup: { limit: 5, windowMs: 60 * 60_000 },
};

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, policy: RateLimitPolicy, now = Date.now()) {
    const current = this.buckets.get(key);
    const bucket = !current || now >= current.resetAt ? { count: 0, resetAt: now + policy.windowMs } : current;
    if (bucket.count >= policy.limit) throw new Error("RATE_LIMITED");
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return { remaining: policy.limit - bucket.count, resetAt: bucket.resetAt };
  }
}

const limiter = new InMemoryRateLimiter();

export function shouldBypassRateLimitsForE2e(
  environment: Partial<Record<string, string | undefined>> = process.env,
) {
  if (
    environment.E2E_RATE_LIMIT_BYPASS !== "1" ||
    environment.AI_ADAPTER !== "test" ||
    environment.LOCAL_RUNTIME_MODE !== "1"
  ) return false;
  try {
    assertIsolatedE2eDatabaseUrl(environment.DATABASE_URL ?? "");
    return true;
  } catch {
    return false;
  }
}

export function enforceRateLimit(scope: RateLimitScope, key: string) {
  if (shouldBypassRateLimitsForE2e()) {
    return { remaining: Number.MAX_SAFE_INTEGER, resetAt: 0 };
  }
  return limiter.consume(`${scope}:${key}`, RATE_LIMIT_POLICIES[scope]);
}

export function requestRateLimitKey(request: Request) {
  const trustedForwarded = process.env.RATE_LIMIT_TRUST_PROXY === "1"
    ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown")
    : "untrusted-network";
  const fingerprint = [trustedForwarded.slice(0, 64), request.headers.get("user-agent")?.slice(0, 160) ?? "unknown", new URL(request.url).origin].join("|");
  return createHmac("sha256", process.env.AUTH_SECRET ?? "local-rate-limit-key").update(fingerprint).digest("hex");
}
