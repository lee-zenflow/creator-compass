import { createHash } from "node:crypto";

export type BackupFile = { path: string; data: Uint8Array };
export type BackupManifest = {
  formatVersion: 1;
  productVersion: string;
  createdAt: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

function assertSafeBackupPath(path: string) {
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("..") || path.includes("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error("BACKUP_PATH_INVALID");
  }
}

function digest(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

export function buildBackupManifest(files: BackupFile[], productVersion: string, now = new Date()): BackupManifest {
  const paths = new Set<string>();
  return {
    formatVersion: 1,
    productVersion,
    createdAt: now.toISOString(),
    files: files.map((file) => {
      assertSafeBackupPath(file.path);
      if (paths.has(file.path)) throw new Error("BACKUP_PATH_INVALID");
      paths.add(file.path);
      return { path: file.path, bytes: file.data.byteLength, sha256: digest(file.data) };
    }),
  };
}

export function verifyBackupManifest(manifest: BackupManifest, files: BackupFile[]) {
  if (manifest.formatVersion !== 1 || manifest.files.length !== files.length) throw new Error("BACKUP_INTEGRITY_FAILED");
  const actual = new Map(files.map((file) => [file.path, file]));
  for (const expected of manifest.files) {
    assertSafeBackupPath(expected.path);
    const file = actual.get(expected.path);
    if (!file || file.data.byteLength !== expected.bytes || digest(file.data) !== expected.sha256) {
      throw new Error("BACKUP_INTEGRITY_FAILED");
    }
  }
}
