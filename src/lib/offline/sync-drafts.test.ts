import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { syncDraft, type DraftSyncRepository } from "./sync-drafts";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

describe("draft synchronization", () => {
  test("preserves both draft versions on a version conflict", async () => {
    const repository: DraftSyncRepository = {
      getRemote: vi.fn(async () => ({ version: 3, content: { title: "服务端" } })),
      save: vi.fn(),
    };
    const local = { id: "creation:c1", entityType: "creation" as const, entityId: "c1", baseVersion: 2, content: { title: "本地" }, updatedAt: "2026-08-09T08:00:00.000Z", state: "pending" as const };
    const result = await syncDraft(actor, local, repository);
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.local.content.title).toBe("本地");
      expect(result.remote.version).toBe(3);
    }
    expect(repository.save).not.toHaveBeenCalled();
  });

  test("saves when the base version still matches", async () => {
    const repository: DraftSyncRepository = {
      getRemote: vi.fn(async () => ({ version: 2, content: { title: "服务端" } })),
      save: vi.fn(async () => ({ version: 3 })),
    };
    const result = await syncDraft(actor, { id: "creation:c1", entityType: "creation", entityId: "c1", baseVersion: 2, content: { title: "本地" }, updatedAt: "2026-08-09T08:00:00.000Z", state: "pending" }, repository);
    expect(result).toEqual({ kind: "synced", version: 3 });
  });
});
