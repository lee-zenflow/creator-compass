import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";

import { DraftStore } from "./draft-store";

describe("offline draft store", () => {
  test("stores only pending drafts and removes them after sync", async () => {
    const store = new DraftStore(`draft-test-${crypto.randomUUID()}`);
    await store.put({ id: "creation:c1", entityType: "creation", entityId: "c1", baseVersion: 2, content: { title: "本地草稿" }, updatedAt: "2026-08-09T08:00:00.000Z", state: "pending" });
    expect((await store.get("creation:c1"))?.content).toEqual({ title: "本地草稿" });
    expect(await store.listPending()).toHaveLength(1);
    await store.remove("creation:c1");
    expect(await store.get("creation:c1")).toBeUndefined();
  });
});
