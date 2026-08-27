import { NextResponse } from "next/server";

import { initializeLocalOwner } from "@/features/identity/local-owner-service";
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
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    }
    const initialized = await initializeLocalOwner({ username: body.username, password: body.password });
    return NextResponse.json({ ok: true, recoveryCodes: initialized.recoveryCodes });
  } catch (error) {
    const code = error instanceof Error ? error.message : "LOCAL_SETUP_FAILED";
    if (code === "LOCAL_INSTANCE_INITIALIZED") {
      return NextResponse.json({ ok: false, error: code }, { status: 409 });
    }
    if (code === "OWNER_USERNAME_INVALID" || code === "OWNER_PASSWORD_INVALID") {
      return NextResponse.json({ ok: false, error: code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "LOCAL_SETUP_FAILED" }, { status: 500 });
  }
}
