import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getTableName } from "drizzle-orm";

import { pool } from "@/server/db/client";
import { PRODUCT_TABLES } from "@/server/db/schema";
import type { BackupFile } from "./backup-manifest";
import type { BackupRuntime, BackupState } from "./backup-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXCLUDED_TABLES = new Set(["guest_sessions", "runtime_heartbeats"]);

export const portableTableNames = [...new Set(Object.values(PRODUCT_TABLES).map(getTableName))]
  .filter((name) => !EXCLUDED_TABLES.has(name))
  .sort();

function commandEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("DATABASE_URL_INVALID");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
  };
}

function postgresExecutable(name: "pg_dump" | "psql", binPath?: string) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return binPath ? join(binPath, `${name}${suffix}`) : `${name}${suffix}`;
}

async function run(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env: environment, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { errorOutput = `${errorOutput}${chunk}`.slice(-4_000); });
    child.once("error", rejectPromise);
    child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`POSTGRES_TOOL_FAILED:${errorOutput.trim()}`)));
  });
}

async function readPrivateFiles(root: string): Promise<BackupFile[]> {
  const absoluteRoot = resolve(root);
  const files: BackupFile[] = [];
  async function walk(directory: string) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_FORBIDDEN");
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push({ path: relative(absoluteRoot, fullPath).replaceAll("\\", "/"), data: new Uint8Array(await readFile(fullPath)) });
    }
  }
  await walk(absoluteRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function safeRestorePath(root: string, path: string) {
  const candidate = resolve(root, ...path.split("/"));
  const within = relative(root, candidate);
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("BACKUP_PATH_INVALID");
  return candidate;
}

export function rewriteBackupStateForOwner(state: BackupState, targetOwnerId: string): BackupState {
  if (!UUID.test(state.sourceOwnerId) || !UUID.test(targetOwnerId)) throw new Error("BACKUP_OWNER_INVALID");
  const source = state.sourceOwnerId;
  return {
    sourceOwnerId: targetOwnerId,
    files: state.files.map((file) => ({
      path: file.path.replaceAll(`/user/${source}/`, `/user/${targetOwnerId}/`),
      data: file.path === "database.sql"
        ? new TextEncoder().encode(new TextDecoder().decode(file.data).replaceAll(source, targetOwnerId))
        : file.data,
    })),
  };
}

export type PostgresBackupEnvironment = {
  DATABASE_URL: string;
  LOCAL_STORAGE_PATH: string;
  POSTGRES_BIN_PATH?: string;
};

export class PostgresBackupRuntime implements BackupRuntime {
  constructor(private readonly environment: PostgresBackupEnvironment) {}

  async currentOwnerId() {
    const result = await pool.query<{ owner_user_id: string }>("select owner_user_id from local_instance where singleton_key = 'owner'");
    const ownerId = result.rows[0]?.owner_user_id;
    if (!ownerId) throw new Error("LOCAL_OWNER_MISSING");
    return ownerId;
  }

  async capture(): Promise<BackupState> {
    const working = await mkdtemp(join(tmpdir(), "creator-compass-backup-"));
    const dumpPath = join(working, "database.sql");
    try {
      const ownerId = await this.currentOwnerId();
      const args = [
        "--data-only", "--column-inserts", "--no-owner", "--no-privileges", "--encoding=UTF8",
        `--file=${dumpPath}`,
        ...portableTableNames.map((table) => `--table=public.${table}`),
      ];
      await run(postgresExecutable("pg_dump", this.environment.POSTGRES_BIN_PATH), args, commandEnvironment(this.environment.DATABASE_URL));
      return {
        sourceOwnerId: ownerId,
        files: [
          { path: "database.sql", data: new Uint8Array(await readFile(dumpPath)) },
          ...await readPrivateFiles(this.environment.LOCAL_STORAGE_PATH),
        ],
      };
    } finally {
      await rm(working, { recursive: true, force: true });
    }
  }

  async restore(input: BackupState, targetOwnerId: string) {
    const state = rewriteBackupStateForOwner(input, targetOwnerId);
    const databaseFile = state.files.find((file) => file.path === "database.sql");
    if (!databaseFile) throw new Error("BACKUP_DATABASE_MISSING");
    const working = await mkdtemp(join(tmpdir(), "creator-compass-restore-"));
    const restoreSqlPath = join(working, "restore.sql");
    const privateRoot = resolve(this.environment.LOCAL_STORAGE_PATH);
    const stagingRoot = join(dirname(privateRoot), `.${basename(privateRoot)}-restore-${randomUUID()}`);
    const previousRoot = join(dirname(privateRoot), `.${basename(privateRoot)}-previous-${randomUUID()}`);
    try {
      await mkdir(stagingRoot, { recursive: true });
      for (const file of state.files.filter((candidate) => candidate.path !== "database.sql")) {
        const destination = safeRestorePath(stagingRoot, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.data, { flag: "wx" });
      }

      const quotedTables = portableTableNames.map((table) => `public."${table.replaceAll('"', '""')}"`).join(", ");
      const sql = `TRUNCATE TABLE ${quotedTables} CASCADE;\n${new TextDecoder().decode(databaseFile.data)}`;
      await writeFile(restoreSqlPath, sql, { flag: "wx" });
      await run(postgresExecutable("psql", this.environment.POSTGRES_BIN_PATH), ["--set=ON_ERROR_STOP=1", "--single-transaction", `--file=${restoreSqlPath}`], commandEnvironment(this.environment.DATABASE_URL));

      if (await lstat(privateRoot).then(() => true).catch(() => false)) await rename(privateRoot, previousRoot);
      await rename(stagingRoot, privateRoot);
      await rm(previousRoot, { recursive: true, force: true });
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
      await rm(working, { recursive: true, force: true });
    }
  }
}

export function createPostgresBackupRuntime(environment: Partial<PostgresBackupEnvironment> = {
  DATABASE_URL: process.env.DATABASE_URL,
  LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH,
  POSTGRES_BIN_PATH: process.env.POSTGRES_BIN_PATH,
}) {
  const databaseUrl = environment.DATABASE_URL;
  const storagePath = environment.LOCAL_STORAGE_PATH;
  if (!databaseUrl || !storagePath) throw new Error("BACKUP_RUNTIME_NOT_CONFIGURED");
  return new PostgresBackupRuntime({
    DATABASE_URL: databaseUrl,
    LOCAL_STORAGE_PATH: storagePath,
    ...(environment.POSTGRES_BIN_PATH ? { POSTGRES_BIN_PATH: environment.POSTGRES_BIN_PATH } : {}),
  });
}
