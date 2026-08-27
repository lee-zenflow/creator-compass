import { sql } from "drizzle-orm";

import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { runtimeHeartbeats } from "@/server/db/schema";
import { getPrivateStorage } from "@/server/storage/local-storage";

type ComponentStatus = "healthy" | "unhealthy";

export type HealthDependencies = {
  expectedMigrationCount: number;
  heartbeatMaxAgeMs: number;
  now: Date;
  database: {
    migrationCount(): Promise<number>;
    workerHeartbeat(): Promise<Date | null>;
  };
  storage: { check(): Promise<void> };
};

export type SystemHealth = {
  status: ComponentStatus;
  checkedAt: string;
  components: {
    web: ComponentStatus;
    database: ComponentStatus;
    worker: ComponentStatus;
    storage: ComponentStatus;
  };
};

export async function checkSystemHealth(dependencies: HealthDependencies): Promise<SystemHealth> {
  const components: SystemHealth["components"] = {
    web: "healthy",
    database: "unhealthy",
    worker: "unhealthy",
    storage: "unhealthy",
  };
  try {
    const count = await dependencies.database.migrationCount();
    components.database = count === dependencies.expectedMigrationCount ? "healthy" : "unhealthy";
  } catch {
    components.database = "unhealthy";
  }
  try {
    const heartbeat = await dependencies.database.workerHeartbeat();
    components.worker = heartbeat && dependencies.now.getTime() - heartbeat.getTime() <= dependencies.heartbeatMaxAgeMs
      ? "healthy"
      : "unhealthy";
  } catch {
    components.worker = "unhealthy";
  }
  try {
    await dependencies.storage.check();
    components.storage = "healthy";
  } catch {
    components.storage = "unhealthy";
  }
  return {
    status: Object.values(components).every((status) => status === "healthy") ? "healthy" : "unhealthy",
    checkedAt: dependencies.now.toISOString(),
    components,
  };
}

export function databaseHealthDependencies(): HealthDependencies["database"] {
  return {
    async migrationCount() {
      const result = await db.execute<{ count: string }>(
        sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async workerHeartbeat() {
      const [row] = await db
        .select({ updatedAt: runtimeHeartbeats.updatedAt })
        .from(runtimeHeartbeats)
        .where(sql`${runtimeHeartbeats.component} = 'worker'`)
        .limit(1);
      return row?.updatedAt ?? null;
    },
  };
}

export function productionHealthDependencies(now = new Date()): HealthDependencies {
  return {
    expectedMigrationCount: Number(process.env.EXPECTED_MIGRATION_COUNT ?? "19"),
    heartbeatMaxAgeMs: Number(process.env.WORKER_HEARTBEAT_MAX_AGE_MS ?? "45000"),
    now,
    database: databaseHealthDependencies(),
    storage: { check: () => getPrivateStorage().check() },
  };
}

export async function touchWorkerHeartbeat(database: CreatorCompassDatabase = db, now = new Date()) {
  await database
    .insert(runtimeHeartbeats)
    .values({ component: "worker", updatedAt: now })
    .onConflictDoUpdate({
      target: runtimeHeartbeats.component,
      set: { updatedAt: now },
    });
}
