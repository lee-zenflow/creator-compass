import { describe, expect, test } from "vitest";

import { buildBackupManifest, verifyBackupManifest } from "./backup-manifest";

describe("backup manifest", () => {
  test("records byte counts and hashes and rejects missing or changed files", () => {
    const files = [
      { path: "database.sql", data: new TextEncoder().encode("insert into reports values (...);") },
      { path: "private/user/u1/a.txt", data: new TextEncoder().encode("source") },
    ];
    const manifest = buildBackupManifest(files, "0.1.0", new Date("2026-08-27T00:00:00.000Z"));

    expect(manifest).toMatchObject({ formatVersion: 1, productVersion: "0.1.0", createdAt: "2026-08-27T00:00:00.000Z" });
    expect(() => verifyBackupManifest(manifest, files)).not.toThrow();
    expect(() => verifyBackupManifest(manifest, [{ ...files[0]!, data: new TextEncoder().encode("changed") }, files[1]!]))
      .toThrow("BACKUP_INTEGRITY_FAILED");
    expect(() => verifyBackupManifest(manifest, [files[0]!])).toThrow("BACKUP_INTEGRITY_FAILED");
  });

  test("rejects unsafe archive paths", () => {
    expect(() => buildBackupManifest([{ path: "../secret", data: new Uint8Array() }], "0.1.0"))
      .toThrow("BACKUP_PATH_INVALID");
  });
});
