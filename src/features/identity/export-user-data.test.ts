import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "./current-actor";
import { exportUserData, type UserExportRepository } from "./export-user-data";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

describe("user data export", () => {
  test("exports grouped product data without auth secrets", async () => {
    const repository: UserExportRepository = { readGroup: vi.fn(async (_actor, group) => group === "profile" ? [{ currentPositioning: "AI产品" }] : []) };
    const stream = await exportUserData(actor, repository);
    const text = await new Response(stream).text();
    const result = JSON.parse(text);
    expect(result.profile[0].currentPositioning).toBe("AI产品");
    expect(text).not.toMatch(/password|tokenHash|accessToken|refreshToken/);
  });
});
