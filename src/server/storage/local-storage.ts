import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { CurrentActor } from "@/features/identity/current-actor";
import { assertAllowedUpload } from "@/server/security/file-policy";
import {
  assertActorObjectKey,
  buildActorObjectKey,
  type ByteRange,
  type PrivateStorage,
  type PrivateUpload,
} from "./storage";

export class LocalPrivateStorage implements PrivateStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async check() {
    await mkdir(this.root, { recursive: true });
  }

  private pathFor(actor: CurrentActor, objectKey: string) {
    assertActorObjectKey(actor, objectKey);
    const candidate = resolve(this.root, ...objectKey.split("/"));
    const pathWithinRoot = relative(this.root, candidate);
    if (!pathWithinRoot || pathWithinRoot.startsWith("..") || isAbsolute(pathWithinRoot)) throw new Error("FORBIDDEN");
    return candidate;
  }

  async put(actor: CurrentActor, upload: PrivateUpload) {
    if (upload.body.byteLength !== upload.bytes) throw new Error("FILE_SIZE_MISMATCH");
    assertAllowedUpload({ ...upload, signature: upload.body.slice(0, 16) });
    const objectKey = buildActorObjectKey(actor, upload.name);
    const filePath = this.pathFor(actor, objectKey);
    const temporaryPath = `${filePath}.part`;
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, upload.body, { flag: "wx" });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { objectKey };
  }

  async get(actor: CurrentActor, objectKey: string, range?: ByteRange) {
    const filePath = this.pathFor(actor, objectKey);
    if (!range) return new Uint8Array(await readFile(filePath));
    const { start, end } = range;
    if (!Number.isSafeInteger(start) || start < 0 || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) {
      throw new Error("INVALID_BYTE_RANGE");
    }
    const handle = await open(filePath, "r");
    try {
      const { size } = await handle.stat();
      if (start >= size) throw new Error("INVALID_BYTE_RANGE");
      const safeEnd = Math.min(end ?? size - 1, size - 1);
      const buffer = new Uint8Array(safeEnd - start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, start);
      return buffer.slice(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async delete(actor: CurrentActor, objectKey: string) {
    await rm(this.pathFor(actor, objectKey), { force: true });
  }
}

type StorageEnvironment = Partial<Record<
  "NODE_ENV" | "LOCAL_RUNTIME_MODE" | "APP_URL" | "LOCAL_STORAGE_PATH",
  string | undefined
>>;

function isExplicitLoopbackRuntime(environment: StorageEnvironment) {
  if (environment.LOCAL_RUNTIME_MODE !== "1" || !environment.APP_URL) return false;
  try {
    const hostname = new URL(environment.APP_URL).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function createPrivateStorage(environment: StorageEnvironment = process.env) {
  if (environment.NODE_ENV === "production" && !isExplicitLoopbackRuntime(environment)) {
    throw new Error("LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION");
  }
  return new LocalPrivateStorage(environment.LOCAL_STORAGE_PATH ?? `${process.cwd()}/.local-data/private`);
}

let sharedStorage: PrivateStorage | undefined;

export function getPrivateStorage(): PrivateStorage {
  sharedStorage ??= createPrivateStorage();
  return sharedStorage;
}
