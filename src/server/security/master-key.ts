import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const MASTER_KEY_FILE_MODE = 0o600;
const MASTER_KEY_DIRECTORY_MODE = 0o700;
const MASTER_KEY_BYTES = 32;

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function validateMasterKey(key: Buffer) {
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error("MASTER_KEY_INVALID");
  }
  return key;
}

async function readExistingMasterKey(path: string) {
  try {
    return validateMasterKey(await readFile(path));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function loadOrCreateMasterKey(path: string): Promise<Buffer> {
  const existing = await readExistingMasterKey(path);
  if (existing) {
    return existing;
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: MASTER_KEY_DIRECTORY_MODE });

  const generated = randomBytes(MASTER_KEY_BYTES);
  const temporaryPath = join(directory, `.master-key-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, generated, {
      flag: "wx",
      mode: MASTER_KEY_FILE_MODE,
    });
    if (process.platform !== "win32") {
      await chmod(temporaryPath, MASTER_KEY_FILE_MODE);
    }

    try {
      await link(temporaryPath, path);
      if (process.platform !== "win32") {
        await chmod(path, MASTER_KEY_FILE_MODE);
      }
      return generated;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
      const racedKey = await readExistingMasterKey(path);
      if (!racedKey) {
        throw new Error("MASTER_KEY_CREATE_FAILED");
      }
      return racedKey;
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    });
  }
}
