import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { createPlatformAccountLabel, setActivePlatformAccount, type PlatformAccountRepository } from "./platform-account-service";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const accountId = "20000000-0000-4000-8000-000000000002";

function repository(overrides: Partial<PlatformAccountRepository> = {}): PlatformAccountRepository {
  const repo: PlatformAccountRepository = {
    transaction: async (work) => work(repo),
    lockOwner: vi.fn(async () => undefined),
    findActive: vi.fn(async () => null),
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: accountId })),
    findOwned: vi.fn(async () => ({ id: accountId })),
    deactivateAll: vi.fn(async () => undefined),
    activate: vi.fn(async () => undefined),
    ...overrides,
  };
  return repo;
}

describe("platform account labels", () => {
  test("makes the first label active without storing authorization data", async () => {
    const repo = repository();
    await createPlatformAccountLabel(actor, { platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr" }, repo);
    expect(repo.create).toHaveBeenCalledWith(actor, {
      platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true,
    });
  });

  test("activates only an account owned by the current actor", async () => {
    const repo = repository();
    await setActivePlatformAccount(actor, accountId, repo);
    expect(repo.deactivateAll).toHaveBeenCalledWith(actor);
    expect(repo.activate).toHaveBeenCalledWith(actor, accountId);
  });
});
