import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SECRET_ENVELOPE_VERSION = 1;
const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

export type SecretEnvelope = {
  version: number;
  ciphertext: string;
  iv: string;
  authTag: string;
};

function assertKey(key: Buffer) {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error("SECRET_KEY_INVALID");
  }
}

export function encryptSecret(plainText: string, key: Buffer): SecretEnvelope {
  assertKey(key);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);

  return {
    version: SECRET_ENVELOPE_VERSION,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(envelope: SecretEnvelope, key: Buffer): string {
  assertKey(key);
  if (envelope.version !== SECRET_ENVELOPE_VERSION) {
    throw new Error("SECRET_ENVELOPE_UNSUPPORTED");
  }

  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    if (iv.length !== GCM_IV_BYTES || authTag.length !== 16) {
      throw new Error("invalid envelope");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("SECRET_DECRYPT_FAILED");
  }
}
