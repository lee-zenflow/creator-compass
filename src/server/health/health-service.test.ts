import { describe, expect, test, vi } from "vitest";

import { checkSystemHealth, productionHealthDependencies } from "./health-service";

describe("system health", () => {
  test("defaults to the current migration count", () => {
    const previous = process.env.EXPECTED_MIGRATION_COUNT;
    delete process.env.EXPECTED_MIGRATION_COUNT;
    try {
      expect(productionHealthDependencies().expectedMigrationCount).toBe(19);
    } finally {
      if (previous === undefined) delete process.env.EXPECTED_MIGRATION_COUNT;
      else process.env.EXPECTED_MIGRATION_COUNT = previous;
    }
  });

  test("reports healthy only when migrations, worker heartbeat and storage are healthy", async () => {
    const now = new Date("2026-08-09T10:00:00.000Z");
    const result = await checkSystemHealth({
      expectedMigrationCount: 13,
      heartbeatMaxAgeMs: 45_000,
      now,
      database: {
        migrationCount: vi.fn(async () => 13),
        workerHeartbeat: vi.fn(async () => new Date(now.getTime() - 10_000)),
      },
      storage: { check: vi.fn(async () => undefined) },
    });

    expect(result.status).toBe("healthy");
    expect(result.components).toEqual({
      web: "healthy",
      database: "healthy",
      worker: "healthy",
      storage: "healthy",
    });
  });

  test("is unhealthy when migrations are missing, heartbeat is stale or storage fails", async () => {
    const now = new Date("2026-08-09T10:00:00.000Z");
    const result = await checkSystemHealth({
      expectedMigrationCount: 13,
      heartbeatMaxAgeMs: 45_000,
      now,
      database: {
        migrationCount: vi.fn(async () => 12),
        workerHeartbeat: vi.fn(async () => new Date(now.getTime() - 60_000)),
      },
      storage: { check: vi.fn(async () => { throw new Error("offline"); }) },
    });

    expect(result.status).toBe("unhealthy");
    expect(result.components).toEqual({
      web: "healthy",
      database: "unhealthy",
      worker: "unhealthy",
      storage: "unhealthy",
    });
  });

  test("checks database, worker and storage independently without exposing dependency errors", async () => {
    const now = new Date("2026-08-09T10:00:00.000Z");
    const workerHeartbeat = vi.fn(async () => new Date(now.getTime() - 10_000));
    const storageCheck = vi.fn(async () => {
      throw new Error("s3://bucketKey?secret=do-not-expose");
    });

    const result = await checkSystemHealth({
      expectedMigrationCount: 16,
      heartbeatMaxAgeMs: 45_000,
      now,
      database: {
        migrationCount: vi.fn(async () => {
          throw new Error("postgres://user:password@database/internal");
        }),
        workerHeartbeat,
      },
      storage: { check: storageCheck },
    });

    expect(workerHeartbeat).toHaveBeenCalledOnce();
    expect(storageCheck).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: "unhealthy",
      checkedAt: now.toISOString(),
      components: {
        web: "healthy",
        database: "unhealthy",
        worker: "healthy",
        storage: "unhealthy",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/postgres:|password|secret|bucketKey/i);
  });
});
