import { describe, expect, test, vi } from "vitest";

import type { BackupFile } from "./backup-manifest";
import {
  createAutomaticSnapshot,
  createPortableBackup,
  inspectPortableBackup,
  restorePortableBackup,
  type BackupRuntime,
  type SnapshotStore,
} from "./backup-service";

function runtime(overrides: Partial<BackupRuntime> = {}): BackupRuntime {
  return {
    capture: vi.fn(async () => ({
      sourceOwnerId: "10000000-0000-4000-8000-000000000001",
      files: [
        { path: "database.sql", data: new TextEncoder().encode("insert into reports values ('ok');") },
        { path: "private/user/10000000-0000-4000-8000-000000000001/source.txt", data: new TextEncoder().encode("source") },
      ] satisfies BackupFile[],
    })),
    currentOwnerId: vi.fn(async () => "20000000-0000-4000-8000-000000000002"),
    restore: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("backup service", () => {
  test("creates an encrypted portable bundle and inspects a verified manifest", async () => {
    const encrypted = await createPortableBackup("portable-password", runtime(), { productVersion: "0.1.0" });
    expect(new TextDecoder().decode(encrypted)).not.toContain("insert into reports");

    const inspected = await inspectPortableBackup(encrypted, "portable-password");
    expect(inspected.manifest.files.map((file) => file.path)).toEqual([
      "database.sql",
      "private/user/10000000-0000-4000-8000-000000000001/source.txt",
    ]);
  });

  test("refuses a capture containing local credentials or sessions", async () => {
    const unsafe = runtime({
      capture: vi.fn(async () => ({
        sourceOwnerId: "10000000-0000-4000-8000-000000000001",
        files: [{ path: "database.sql", data: new TextEncoder().encode('INSERT INTO public."deepseek_credentials" VALUES (\'secret\');') }],
      })),
    });
    await expect(createPortableBackup("portable-password", unsafe)).rejects.toThrow("BACKUP_CONTAINS_LOCAL_SECRET");
  });

  test("validates before restore, creates a rollback point, and rolls back a failed import", async () => {
    const source = runtime();
    const encrypted = await createPortableBackup("portable-password", source);
    const rollback = vi.fn(async () => undefined);
    const failing = runtime({
      restore: vi.fn(async () => { throw new Error("restore failed"); }),
    });

    await expect(restorePortableBackup(encrypted, "portable-password", failing, {
      createRollbackPoint: vi.fn(async () => rollback),
    })).rejects.toThrow("BACKUP_RESTORE_FAILED");
    expect(failing.restore).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOwnerId: "10000000-0000-4000-8000-000000000001" }),
      "20000000-0000-4000-8000-000000000002",
    );
    expect(rollback).toHaveBeenCalledOnce();
  });

  test("retains exactly seven successful automatic snapshots", async () => {
    const entries = new Map<string, Uint8Array>();
    const store: SnapshotStore = {
      write: vi.fn(async (name, bytes) => { entries.set(name, bytes); }),
      list: vi.fn(async () => [...entries.keys()].sort()),
      delete: vi.fn(async (name) => { entries.delete(name); }),
    };
    for (let day = 1; day <= 9; day += 1) {
      await createAutomaticSnapshot(runtime(), store, "device-master-key-password", {
        now: new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`),
      });
    }
    expect(entries.size).toBe(7);
    expect([...entries.keys()].sort()[0]).toContain("2026-08-03");
  });
});
