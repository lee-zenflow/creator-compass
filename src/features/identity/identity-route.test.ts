import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeLocalOwner: vi.fn(),
  consumeRecoveryCode: vi.fn(),
  getLocalInstanceState: vi.fn(),
  authHandler: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/features/identity/local-owner-service", () => ({
  LOCAL_OWNER_EMAIL: "owner@creator-compass.local",
  initializeLocalOwner: mocks.initializeLocalOwner,
  consumeRecoveryCode: mocks.consumeRecoveryCode,
  getLocalInstanceState: mocks.getLocalInstanceState,
}));

vi.mock("@/lib/auth/auth", () => ({ auth: { handler: mocks.authHandler } }));
vi.mock("@/server/security/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  requestRateLimitKey: vi.fn(() => "request-key"),
}));

import { POST as login } from "@/app/api/identity/login/route";
import { POST as recover } from "@/app/api/identity/recovery/route";
import { POST as setup } from "@/app/api/identity/setup/route";

describe("local identity mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://creator.example";
    mocks.getLocalInstanceState.mockResolvedValue({ initialized: true, ownerName: "本地创作者" });
  });

  test("returns the one-time recovery codes after trusted setup", async () => {
    mocks.initializeLocalOwner.mockResolvedValue({
      initialized: true,
      recoveryCodes: ["CC-AAAA-BBBB-1111"],
    });
    const response = await setup(
      new Request("https://creator.example/api/identity/setup", {
        method: "POST",
        headers: { origin: "https://creator.example", "content-type": "application/json" },
        body: JSON.stringify({ username: "本地创作者", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      recoveryCodes: ["CC-AAAA-BBBB-1111"],
    });
  });

  test("returns conflict when setup is already closed", async () => {
    mocks.initializeLocalOwner.mockRejectedValue(new Error("LOCAL_INSTANCE_INITIALIZED"));
    const response = await setup(
      new Request("https://creator.example/api/identity/setup", {
        method: "POST",
        headers: { origin: "https://creator.example", "content-type": "application/json" },
        body: JSON.stringify({ username: "second", password: "another-password" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("another-password");
  });

  test("consumes a recovery code without returning it", async () => {
    mocks.consumeRecoveryCode.mockResolvedValue({ reset: true });
    const response = await recover(
      new Request("https://creator.example/api/identity/recovery", {
        method: "POST",
        headers: { origin: "https://creator.example", "content-type": "application/json" },
        body: JSON.stringify({ code: "CC-AAAA-BBBB-1111", password: "replacement-password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects the wrong visible username before Better Auth", async () => {
    const response = await login(
      new Request("https://creator.example/api/identity/login", {
        method: "POST",
        headers: { origin: "https://creator.example", "content-type": "application/json" },
        body: JSON.stringify({ username: "not-owner", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  test("translates the Owner username to the internal email only on the server", async () => {
    let internalBody: unknown;
    mocks.authHandler.mockImplementationOnce(async (request: Request) => {
      internalBody = await request.json();
      return Response.json({ user: { id: "owner-1" } });
    });
    const response = await login(
      new Request("https://creator.example/api/identity/login", {
        method: "POST",
        headers: { origin: "https://creator.example", "content-type": "application/json" },
        body: JSON.stringify({ username: "本地创作者", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(internalBody).toEqual({
      email: "owner@creator-compass.local",
      password: "correct-horse-battery",
      callbackURL: "/workspace",
    });
  });
});
