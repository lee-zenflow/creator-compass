import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { SnapshotStore } from "./backup-service";

function safeName(name: string) {
  if (!/^snapshot-[0-9TZ.\-]+\.ccbackup$/.test(name) || basename(name) !== name) throw new Error("SNAPSHOT_NAME_INVALID");
  return name;
}

export class LocalSnapshotStore implements SnapshotStore {
  private readonly root: string;

  constructor(root: string) { this.root = resolve(root); }

  async write(name: string, bytes: Uint8Array) {
    const target = join(this.root, safeName(name));
    const temporary = `${target}.part`;
    await mkdir(this.root, { recursive: true });
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async read(name: string) { return new Uint8Array(await readFile(join(this.root, safeName(name)))); }

  async list() {
    try { return (await readdir(this.root)).filter((entry) => /^snapshot-[0-9TZ.\-]+\.ccbackup$/.test(entry)).sort(); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async delete(name: string) { await rm(join(this.root, safeName(name)), { force: true }); }
}
