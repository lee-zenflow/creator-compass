import { gzipSync, gunzipSync } from "node:zlib";

import { decryptPortableBackup, encryptPortableBackup } from "./backup-crypto";
import {
  buildBackupManifest,
  verifyBackupManifest,
  type BackupFile,
  type BackupManifest,
} from "./backup-manifest";

export type BackupState = { sourceOwnerId: string; files: BackupFile[] };

export interface BackupRuntime {
  capture(): Promise<BackupState>;
  currentOwnerId(): Promise<string>;
  restore(state: BackupState, targetOwnerId: string): Promise<void>;
}

export interface SnapshotStore {
  write(name: string, bytes: Uint8Array): Promise<void>;
  list(): Promise<string[]>;
  delete(name: string): Promise<void>;
}

type BackupOptions = { productVersion?: string; now?: Date };
type EncodedPayload = {
  manifest: BackupManifest;
  sourceOwnerId: string;
  files: Array<{ path: string; data: string }>;
};

const FORBIDDEN_DATABASE_TABLES = [
  "user",
  "account",
  "session",
  "verification",
  "guest_sessions",
  "local_instance",
  "owner_recovery_codes",
  "deepseek_credentials",
] as const;

function assertNoLocalSecrets(files: BackupFile[]) {
  const databaseFiles = files.filter((file) => file.path === "database.sql");
  if (databaseFiles.length !== 1) throw new Error("BACKUP_DATABASE_MISSING");
  const sql = new TextDecoder().decode(databaseFiles[0]!.data);
  for (const table of FORBIDDEN_DATABASE_TABLES) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:INSERT\\s+INTO|COPY)\\s+(?:public\\.)?[\"']?${escaped}[\"']?`, "i").test(sql)) {
      throw new Error("BACKUP_CONTAINS_LOCAL_SECRET");
    }
  }
}

function encodeState(state: BackupState, options: BackupOptions = {}) {
  assertNoLocalSecrets(state.files);
  const manifest = buildBackupManifest(state.files, options.productVersion ?? process.env.npm_package_version ?? "0.1.0", options.now);
  const payload: EncodedPayload = {
    manifest,
    sourceOwnerId: state.sourceOwnerId,
    files: state.files.map((file) => ({ path: file.path, data: Buffer.from(file.data).toString("base64") })),
  };
  return gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
}

function decodeState(bytes: Uint8Array): { manifest: BackupManifest; state: BackupState } {
  try {
    const raw = JSON.parse(gunzipSync(bytes).toString("utf8")) as Partial<EncodedPayload>;
    if (!raw.manifest || raw.manifest.formatVersion !== 1 || typeof raw.sourceOwnerId !== "string" || !Array.isArray(raw.files)) {
      throw new Error("BACKUP_FORMAT_INVALID");
    }
    const files = raw.files.map((file) => {
      if (!file || typeof file.path !== "string" || typeof file.data !== "string") throw new Error("BACKUP_FORMAT_INVALID");
      return { path: file.path, data: new Uint8Array(Buffer.from(file.data, "base64")) };
    });
    verifyBackupManifest(raw.manifest, files);
    assertNoLocalSecrets(files);
    return { manifest: raw.manifest, state: { sourceOwnerId: raw.sourceOwnerId, files } };
  } catch (error) {
    if (error instanceof Error && [
      "BACKUP_FORMAT_INVALID",
      "BACKUP_INTEGRITY_FAILED",
      "BACKUP_PATH_INVALID",
      "BACKUP_DATABASE_MISSING",
      "BACKUP_CONTAINS_LOCAL_SECRET",
    ].includes(error.message)) throw error;
    throw new Error("BACKUP_FORMAT_INVALID");
  }
}

export async function createPortableBackup(password: string, runtime: BackupRuntime, options: BackupOptions = {}) {
  return encryptPortableBackup(encodeState(await runtime.capture(), options), password);
}

export async function inspectPortableBackup(envelope: Uint8Array, password: string) {
  return decodeState(await decryptPortableBackup(envelope, password));
}

export async function restorePortableBackup(
  envelope: Uint8Array,
  password: string,
  runtime: BackupRuntime,
  safeguards: { createRollbackPoint(): Promise<() => Promise<void>> },
) {
  const inspected = await inspectPortableBackup(envelope, password);
  const targetOwnerId = await runtime.currentOwnerId();
  const rollback = await safeguards.createRollbackPoint();
  try {
    await runtime.restore(inspected.state, targetOwnerId);
    return inspected.manifest;
  } catch {
    await rollback();
    throw new Error("BACKUP_RESTORE_FAILED");
  }
}

export async function createAutomaticSnapshot(
  runtime: BackupRuntime,
  store: SnapshotStore,
  deviceSecret: string,
  options: BackupOptions = {},
) {
  const now = options.now ?? new Date();
  const encrypted = await encryptPortableBackup(encodeState(await runtime.capture(), { ...options, now }), deviceSecret);
  const name = `snapshot-${now.toISOString().replaceAll(":", "-")}.ccbackup`;
  await store.write(name, encrypted);
  const snapshots = (await store.list()).filter((entry) => entry.startsWith("snapshot-") && entry.endsWith(".ccbackup")).sort();
  for (const expired of snapshots.slice(0, Math.max(0, snapshots.length - 7))) await store.delete(expired);
  return { name, bytes: encrypted.byteLength };
}
