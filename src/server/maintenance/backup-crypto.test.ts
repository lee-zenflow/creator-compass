import { describe, expect, test } from "vitest";

import { decryptPortableBackup, encryptPortableBackup } from "./backup-crypto";

describe("portable backup encryption", () => {
  test("round-trips with scrypt and AES-256-GCM while randomizing every envelope", async () => {
    const plaintext = new TextEncoder().encode("Creator Compass 本地备份");
    const first = await encryptPortableBackup(plaintext, "a-long-backup-password");
    const second = await encryptPortableBackup(plaintext, "a-long-backup-password");

    expect(first).not.toEqual(second);
    await expect(decryptPortableBackup(first, "a-long-backup-password").then(Array.from))
      .resolves.toEqual(Array.from(plaintext));
  });

  test("rejects a wrong password and authenticated-envelope tampering", async () => {
    const encrypted = await encryptPortableBackup(new TextEncoder().encode("private"), "correct-password");
    await expect(decryptPortableBackup(encrypted, "wrong-password")).rejects.toThrow("BACKUP_DECRYPT_FAILED");

    const tampered = encrypted.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await expect(decryptPortableBackup(tampered, "correct-password")).rejects.toThrow("BACKUP_DECRYPT_FAILED");
  });

  test("rejects malformed envelopes and short passwords", async () => {
    await expect(encryptPortableBackup(new Uint8Array(), "short")).rejects.toThrow("BACKUP_PASSWORD_TOO_SHORT");
    await expect(decryptPortableBackup(new Uint8Array([1, 2, 3]), "a-long-backup-password"))
      .rejects.toThrow("BACKUP_FORMAT_INVALID");
  });
});
