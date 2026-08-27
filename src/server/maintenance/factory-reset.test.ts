import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { factoryReset, type FactoryResetRepository, type StagedLocalReset } from "./factory-reset";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "admin" };

function dependencies(passwordValid = true) {
  const calls: string[] = [];
  const repository: FactoryResetRepository = {
    passwordHash: vi.fn(async () => "stored-hash"),
    eraseAll: vi.fn(async () => { calls.push("database"); }),
  };
  const staged: StagedLocalReset = {
    commit: vi.fn(async () => { calls.push("files-commit"); }),
    rollback: vi.fn(async () => { calls.push("files-rollback"); }),
  };
  return {
    calls,
    repository,
    stageLocalData: vi.fn(async () => { calls.push("files-stage"); return staged; }),
    verifyPassword: vi.fn(async () => passwordValid),
    staged,
  };
}

const validInput = {
  password: "correct-password",
  confirmation: "恢复出厂状态",
  backupAcknowledged: true,
  secondConfirmation: true,
};

describe("factory reset", () => {
  test("changes nothing when confirmation, second confirmation, or password is wrong", async () => {
    for (const input of [
      { ...validInput, confirmation: "删除账号" },
      { ...validInput, backupAcknowledged: false },
      { ...validInput, secondConfirmation: false },
    ]) {
      const deps = dependencies();
      await expect(factoryReset(actor, input, deps)).rejects.toThrow("FACTORY_RESET_CONFIRMATION_REQUIRED");
      expect(deps.repository.eraseAll).not.toHaveBeenCalled();
      expect(deps.stageLocalData).not.toHaveBeenCalled();
    }
    const deps = dependencies(false);
    await expect(factoryReset(actor, validInput, deps)).rejects.toThrow("FACTORY_RESET_PASSWORD_INVALID");
    expect(deps.stageLocalData).not.toHaveBeenCalled();
  });

  test("quarantines private files and snapshots before clearing the database", async () => {
    const deps = dependencies();
    await factoryReset(actor, validInput, deps);
    expect(deps.calls).toEqual(["files-stage", "database", "files-commit"]);
  });

  test("restores quarantined local data when the database reset fails", async () => {
    const deps = dependencies();
    deps.repository.eraseAll = vi.fn(async () => { throw new Error("database failed"); });
    await expect(factoryReset(actor, validInput, deps)).rejects.toThrow("FACTORY_RESET_FAILED");
    expect(deps.staged.rollback).toHaveBeenCalledOnce();
    expect(deps.staged.commit).not.toHaveBeenCalled();
  });
});
