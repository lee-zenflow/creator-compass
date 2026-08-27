import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { deepseekCredentials } from "@/server/db/schema";
import { loadOrCreateMasterKey } from "@/server/security/master-key";
import {
  createAutomaticSnapshot,
  createPortableBackup,
  restorePortableBackup,
} from "./backup-service";
import { LocalSnapshotStore } from "./local-snapshot-store";
import { createPostgresBackupRuntime } from "./postgres-backup-runtime";

function configuration() {
  const masterKeyPath = process.env.CREATOR_COMPASS_MASTER_KEY_PATH;
  const snapshotPath = process.env.LOCAL_SNAPSHOT_PATH;
  if (!masterKeyPath || !snapshotPath) throw new Error("BACKUP_RUNTIME_NOT_CONFIGURED");
  return { masterKeyPath, snapshotPath };
}

export async function createLocalPortableBackup(password: string) {
  return createPortableBackup(password, createPostgresBackupRuntime());
}

export async function restoreLocalPortableBackup(bytes: Uint8Array, password: string) {
  const config = configuration();
  const runtime = createPostgresBackupRuntime();
  const store = new LocalSnapshotStore(config.snapshotPath);
  const masterKey = await loadOrCreateMasterKey(config.masterKeyPath);
  const deviceSecret = masterKey.toString("base64url");
  await restorePortableBackup(bytes, password, runtime, {
    async createRollbackPoint() {
      const before = await runtime.capture();
      const ownerId = await runtime.currentOwnerId();
      await createAutomaticSnapshot(runtime, store, deviceSecret);
      return () => runtime.restore(before, ownerId);
    },
  });
  const ownerId = await runtime.currentOwnerId();
  await db.delete(deepseekCredentials).where(eq(deepseekCredentials.userId, ownerId));
}
