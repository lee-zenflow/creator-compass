import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "./current-actor";
import { factoryResetIntent } from "./account-actions";

const actor: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};

describe("factory reset action", () => {
  test("passes only the resolved actor and explicit confirmations", async () => {
    const reset = vi.fn(async () => undefined);
    const input = {
      password: "correct-password",
      confirmation: "恢复出厂状态",
      backupAcknowledged: true,
      secondConfirmation: true,
    };
    await factoryResetIntent(actor, input, reset);
    expect(reset).toHaveBeenCalledWith(actor, input);
  });

  test("never allows a guest actor to reset local data", async () => {
    const reset = vi.fn(async () => undefined);
    await expect(factoryResetIntent(
      { kind: "guest", guestSessionId: "20000000-0000-4000-8000-000000000002" },
      { password: "correct-password", confirmation: "恢复出厂状态", backupAcknowledged: true, secondConfirmation: true },
      reset,
    )).rejects.toThrow("FORBIDDEN");
    expect(reset).not.toHaveBeenCalled();
  });
});
