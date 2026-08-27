import { NextResponse } from "next/server";

import {
  LOCAL_OWNER_EMAIL,
  getLocalInstanceState,
} from "@/features/identity/local-owner-service";
import { auth } from "@/lib/auth/auth";
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

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }
  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  const instance = await getLocalInstanceState();
  if (!instance.initialized) {
    return NextResponse.json({ ok: false, error: "LOCAL_SETUP_REQUIRED" }, { status: 409 });
  }
  if (body.username.trim() !== instance.ownerName) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return auth.handler(
    new Request(new URL("/api/auth/sign-in/email", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: LOCAL_OWNER_EMAIL,
        password: body.password,
        callbackURL: "/workspace",
      }),
    }),
  );
}
