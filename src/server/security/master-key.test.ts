import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { MASTER_KEY_FILE_MODE, loadOrCreateMasterKey } from "./master-key";

const temporaryDirectories: string[] = [];

async function temporaryKeyPath() {
  const directory = await mkdtemp(join(tmpdir(), "creator-compass-key-"));
  temporaryDirectories.push(directory);
  return join(directory, "secrets", "master.key");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("local master key", () => {
  test("creates one 256-bit key and reuses it", async () => {
    const path = await temporaryKeyPath();

    const first = await loadOrCreateMasterKey(path);
    const second = await loadOrCreateMasterKey(path);

    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
    expect((await readFile(path)).equals(first)).toBe(true);
  });

  test("uses an exclusive 0600 file policy", async () => {
    const path = await temporaryKeyPath();
    await loadOrCreateMasterKey(path);

    expect(MASTER_KEY_FILE_MODE).toBe(0o600);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  test("returns the same key when initialization races", async () => {
    const path = await temporaryKeyPath();

    const keys = await Promise.all(
      Array.from({ length: 8 }, () => loadOrCreateMasterKey(path)),
    );

    expect(keys.every((key) => key.equals(keys[0]!))).toBe(true);
  });

  test("rejects a malformed existing key", async () => {
    const path = await temporaryKeyPath();
    await loadOrCreateMasterKey(path);
    await writeFile(path, Buffer.from("not-32-bytes"));

    await expect(loadOrCreateMasterKey(path)).rejects.toThrow("MASTER_KEY_INVALID");
  });
});
