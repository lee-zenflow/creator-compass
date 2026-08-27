import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { decryptSecret, encryptSecret } from "./key-envelope";

describe("secret envelope", () => {
  test("encrypts the same secret with a fresh IV and decrypts both envelopes", () => {
    const key = randomBytes(32);

    const first = encryptSecret("sk-example", key);
    const second = encryptSecret("sk-example", key);

    expect(first.version).toBe(1);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptSecret(first, key)).toBe("sk-example");
    expect(decryptSecret(second, key)).toBe("sk-example");
  });

  test("rejects a tampered envelope without exposing crypto details", () => {
    const key = randomBytes(32);
    const envelope = encryptSecret("sk-example", key);
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

    expect(() =>
      decryptSecret({ ...envelope, ciphertext: ciphertext.toString("base64") }, key),
    ).toThrow("SECRET_DECRYPT_FAILED");
  });

  test("rejects unsupported versions and non-256-bit keys", () => {
    const key = randomBytes(32);
    const envelope = encryptSecret("sk-example", key);

    expect(() => decryptSecret({ ...envelope, version: 2 }, key)).toThrow(
      "SECRET_ENVELOPE_UNSUPPORTED",
    );
    expect(() => encryptSecret("sk-example", randomBytes(16))).toThrow(
      "SECRET_KEY_INVALID",
    );
  });
});
