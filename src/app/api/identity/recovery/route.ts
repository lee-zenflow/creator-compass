import { NextResponse } from "next/server";

import { consumeRecoveryCode } from "@/features/identity/local-owner-service";
import { assertTrustedMutationOrigin } from "@/lib/auth/security";
import { enforceRateLimit, requestRateLimitKey } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request.headers.get("origin"), process.env.APP_URL ?? "http://localhost:3000");
    enforceRateLimit("auth", requestRateLimitKey(request));
  } catch (error) {
    const status = error instanceof Error && error.message === "RATE_LIMITED" ? 429 : 403;
    return NextResponse.json({ ok: false, error: status === 429 ? "RATE_LIMITED" : "FORBIDDEN" }, { status });
  }

  try {
    const body = (await request.json()) as { code?: unknown; password?: unknown };
    if (typeof body.code !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    }
    await consumeRecoveryCode({ code: body.code, password: body.password });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "RECOVERY_FAILED";
    if (code === "RECOVERY_CODE_INVALID" || code === "OWNER_PASSWORD_INVALID") {
      return NextResponse.json({ ok: false, error: code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "RECOVERY_FAILED" }, { status: 500 });
  }
}
