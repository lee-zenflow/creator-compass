import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  put: vi.fn(async () => ({ objectKey: "private/user/u1/file.png" })),
  resolveCurrentActor: vi.fn(async () => ({ kind: "user", userId: "u1", role: "user" })),
  enforceRateLimit: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock("@/features/identity/current-actor", () => ({ resolveCurrentActor: mocks.resolveCurrentActor }));
vi.mock("@/server/storage/local-storage", () => ({ getPrivateStorage: () => ({ put: mocks.put }) }));
vi.mock("@/server/security/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

import { POST } from "@/app/api/storage/private/route";

describe("private upload route", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.APP_URL = "https://creator.example"; });

  test("uploads only the server-resolved actor file", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = { name: "review.png", type: "image/png", arrayBuffer: vi.fn(async () => bytes.buffer) };
    const request = new Request("https://creator.example/api/storage/private", { method: "POST", headers: { origin: "https://creator.example" } });
    vi.spyOn(request, "formData").mockResolvedValue({ get: (key: string) => key === "file" ? file : key === "userId" ? "attacker" : null } as unknown as FormData);
    const response = await POST(request);
    expect({ status: response.status, body: await response.clone().json() }).toEqual({ status: 201, body: { objectKey: "private/user/u1/file.png" } });
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), expect.objectContaining({ name: "review.png", mime: "image/png" }));
  });
});
