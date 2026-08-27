import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { LocalPrivateStorage } from "./local-storage";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

describe("local private storage", () => {
  test("atomically stores and deletes Owner-scoped objects without exposing another actor", async () => {
    const root = await mkdtemp(join(tmpdir(), "creator-compass-storage-"));
    const storage = new LocalPrivateStorage(root);
    await storage.check();
    const result = await storage.put(actor, {
      name: "review.png",
      mime: "image/png",
      bytes: 8,
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      signature: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(readFile(join(root, ...result.objectKey.split("/")))).resolves.toHaveLength(8);
    await expect(storage.get(actor, result.objectKey)).resolves.toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.objectKey).toMatch(/^private\/user\/10000000-0000-4000-8000-000000000001\//);
    await expect(storage.get(
      { kind: "user", userId: "20000000-0000-4000-8000-000000000002", role: "user" },
      result.objectKey,
    )).rejects.toThrow("FORBIDDEN");
    await storage.delete(actor, result.objectKey);
    await expect(readFile(join(root, ...result.objectKey.split("/")))).rejects.toThrow();
  });

  test("rejects traversal and returns only a validated inclusive byte range", async () => {
    const root = await mkdtemp(join(tmpdir(), "creator-compass-storage-"));
    const storage = new LocalPrivateStorage(root);
    await storage.check();
    const { objectKey } = await storage.put(actor, {
      name: "fixed.txt",
      mime: "text/plain",
      bytes: 10,
      body: new TextEncoder().encode("0123456789"),
      signature: new TextEncoder().encode("0123456789"),
    });

    await expect(storage.get(actor, objectKey, { start: 2, end: 5 }).then(Array.from)).resolves.toEqual(
      Array.from(new TextEncoder().encode("2345")),
    );
    await expect(storage.get(actor, objectKey, { start: -1, end: 5 })).rejects.toThrow("INVALID_BYTE_RANGE");
    await expect(storage.get(actor, objectKey, { start: 8, end: 7 })).rejects.toThrow("INVALID_BYTE_RANGE");
    await expect(storage.get(actor, `private/user/${actor.userId}/../secret.txt`)).rejects.toThrow("FORBIDDEN");
  });
});
