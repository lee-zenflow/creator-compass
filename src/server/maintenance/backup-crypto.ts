import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
const MAGIC = Buffer.from("CCBK");
const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + SALT_BYTES + IV_BYTES + TAG_BYTES;

async function deriveKey(password: string, salt: Uint8Array) {
  if (password.length < 10) throw new Error("BACKUP_PASSWORD_TOO_SHORT");
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function encryptPortableBackup(plaintext: Uint8Array, password: string) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt);
  const authenticatedHeader = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(authenticatedHeader);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([authenticatedHeader, cipher.getAuthTag(), ciphertext]));
}

export async function decryptPortableBackup(envelope: Uint8Array, password: string) {
  const bytes = Buffer.from(envelope);
  if (
    bytes.length < HEADER_BYTES
    || !bytes.subarray(0, MAGIC.length).equals(MAGIC)
    || bytes[MAGIC.length] !== FORMAT_VERSION
  ) throw new Error("BACKUP_FORMAT_INVALID");

  const saltStart = MAGIC.length + 1;
  const ivStart = saltStart + SALT_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const authenticatedHeader = bytes.subarray(0, tagStart);
  const salt = bytes.subarray(saltStart, ivStart);
  const iv = bytes.subarray(ivStart, tagStart);
  const tag = bytes.subarray(tagStart, ciphertextStart);
  try {
    const key = await deriveKey(password, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(authenticatedHeader);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(ciphertextStart)), decipher.final()]));
  } catch (error) {
    if (error instanceof Error && error.message === "BACKUP_PASSWORD_TOO_SHORT") throw error;
    throw new Error("BACKUP_DECRYPT_FAILED");
  }
}
