import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { verifyPassword as verifyBetterAuthPassword } from "better-auth/crypto";
import { getTableName } from "drizzle-orm";

import type { CurrentActor } from "@/features/identity/current-actor";
import { pool } from "@/server/db/client";
import { PRODUCT_TABLES, runtimeHeartbeats } from "@/server/db/schema";

export interface FactoryResetRepository {
  passwordHash(userId: string): Promise<string | null>;
  eraseAll(userId: string): Promise<void>;
}

export interface StagedLocalReset {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

type FactoryResetInput = {
  password: string;
  confirmation: string;
  backupAcknowledged: boolean;
  secondConfirmation: boolean;
};

type FactoryResetDependencies = {
  repository: FactoryResetRepository;
  verifyPassword(input: { hash: string; password: string }): Promise<boolean>;
  stageLocalData(): Promise<StagedLocalReset>;
};

const RESET_TABLES = [...new Set([...Object.values(PRODUCT_TABLES).map(getTableName), getTableName(runtimeHeartbeats)])].sort();

function quotedIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"`; }

export const databaseFactoryResetRepository: FactoryResetRepository = {
  async passwordHash(userId) {
    const result = await pool.query<{ password: string | null }>(
      `select password from account where user_id = $1 and provider_id = 'credential' limit 1`,
      [userId],
    );
    return result.rows[0]?.password ?? null;
  },
  async eraseAll(userId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`TRUNCATE TABLE ${RESET_TABLES.map(quotedIdentifier).join(", ")} CASCADE`);
      await client.query("DELETE FROM local_instance WHERE owner_user_id = $1", [userId]);
      await client.query("DELETE FROM verification");
      const deleted = await client.query(`DELETE FROM "user" WHERE id = $1 RETURNING id`, [userId]);
      if (deleted.rowCount !== 1) throw new Error("LOCAL_OWNER_MISSING");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

function assertSafeLocalDataRoot(path: string) {
  const root = resolve(path);
  if (!isAbsolute(root) || root === parse(root).root || dirname(root) === parse(root).root) throw new Error("FACTORY_RESET_PATH_UNSAFE");
  return root;
}

async function exists(path: string) { return lstat(path).then(() => true).catch(() => false); }

export async function stageConfiguredLocalData(paths: string[]): Promise<StagedLocalReset> {
  const staged: Array<{ source: string; quarantine: string }> = [];
  try {
    for (const configured of [...new Set(paths)]) {
      const source = assertSafeLocalDataRoot(configured);
      if (!await exists(source)) continue;
      const quarantine = `${source}.factory-reset-${randomUUID()}`;
      await rename(source, quarantine);
      staged.push({ source, quarantine });
    }
  } catch (error) {
    for (const entry of staged.reverse()) await rename(entry.quarantine, entry.source).catch(() => undefined);
    throw error;
  }
  return {
    async commit() {
      for (const entry of staged) await rm(entry.quarantine, { recursive: true, force: true });
    },
    async rollback() {
      for (const entry of [...staged].reverse()) {
        await rm(entry.source, { recursive: true, force: true });
        await rename(entry.quarantine, entry.source);
      }
    },
  };
}

function configuredLocalDataReset() {
  const paths = [process.env.LOCAL_STORAGE_PATH, process.env.LOCAL_SNAPSHOT_PATH].filter((path): path is string => Boolean(path));
  if (paths.length !== 2) throw new Error("BACKUP_RUNTIME_NOT_CONFIGURED");
  return stageConfiguredLocalData(paths);
}

const defaultDependencies: FactoryResetDependencies = {
  repository: databaseFactoryResetRepository,
  verifyPassword: verifyBetterAuthPassword,
  stageLocalData: configuredLocalDataReset,
};

export async function factoryReset(
  actor: CurrentActor,
  input: FactoryResetInput,
  dependencies: FactoryResetDependencies = defaultDependencies,
) {
  if (actor.kind !== "user") throw new Error("FORBIDDEN");
  if (
    input.confirmation.trim() !== "恢复出厂状态"
    || !input.backupAcknowledged
    || !input.secondConfirmation
  ) throw new Error("FACTORY_RESET_CONFIRMATION_REQUIRED");
  const passwordHash = await dependencies.repository.passwordHash(actor.userId);
  if (!passwordHash || !await dependencies.verifyPassword({ hash: passwordHash, password: input.password })) {
    throw new Error("FACTORY_RESET_PASSWORD_INVALID");
  }

  const staged = await dependencies.stageLocalData();
  try {
    await dependencies.repository.eraseAll(actor.userId);
    await staged.commit();
  } catch {
    await staged.rollback();
    throw new Error("FACTORY_RESET_FAILED");
  }
}
