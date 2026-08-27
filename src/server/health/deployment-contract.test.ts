import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import { productionHealthDependencies } from "./health-service";

type ComposeService = {
  build?: string;
  command?: string | string[];
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
};

describe("production deployment contract", () => {
  test("defines database, private storage, migration and a health-checked app", async () => {
    const compose = parse(await readFile("docker-compose.production.yml", "utf8")) as {
      services: Record<string, ComposeService>;
    };
    expect(Object.keys(compose.services)).toEqual(
      expect.arrayContaining(["postgres", "migrate", "app"]),
    );
    expect(Object.keys(compose.services)).not.toEqual(expect.arrayContaining(["minio", "mailpit"]));
    expect(compose.services.migrate?.command).toEqual(["pnpm", "db:migrate"]);
    expect(compose.services.app?.build).toBe(".");
    const previousMigrationCount = process.env.EXPECTED_MIGRATION_COUNT;
    delete process.env.EXPECTED_MIGRATION_COUNT;
    try {
      expect(compose.services.app?.environment?.EXPECTED_MIGRATION_COUNT).toBe(
        String(productionHealthDependencies().expectedMigrationCount),
      );
    } finally {
      if (previousMigrationCount === undefined) delete process.env.EXPECTED_MIGRATION_COUNT;
      else process.env.EXPECTED_MIGRATION_COUNT = previousMigrationCount;
    }
    expect(JSON.stringify(compose.services.app?.healthcheck?.test)).toContain("/api/health");
  });

  test("builds on Node 22 and starts both web and worker through the supervisor", async () => {
    const [dockerfile, supervisor] = await Promise.all([
      readFile("Dockerfile", "utf8"),
      readFile("scripts/start-production.mjs", "utf8"),
    ]);
    expect(dockerfile).toMatch(/FROM node:22-alpine/);
    expect(dockerfile).toContain('CMD ["node", "scripts/start-production.mjs"]');
    expect(supervisor).toContain('["start"]');
    expect(supervisor).toContain('["dist/ai-worker.js"]');
    expect(supervisor).toContain("SIGTERM");
    expect(supervisor).toContain("process.exitCode =");
  });

  test("provides a Windows release gate that cannot silently skip database-backed E2E", async () => {
    const script = await readFile("scripts/verify-release.ps1", "utf8");

    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toMatch(/IsNullOrWhiteSpace\(\$env:E2E_DATABASE_URL\)/);
    expect(script).toContain("$env:DATABASE_URL = $env:E2E_DATABASE_URL");
    expect(script).toContain("$env:TEST_DATABASE_URL = $env:E2E_DATABASE_URL");
    expect(script).toContain("$env:E2E_BASE_URL = 'http://localhost:3101'");
    expect(script).toContain("$env:PORT = '3101'");
    expect(script).toContain("$env:E2E_REUSE_EXISTING_SERVER = '0'");
    expect(script).toContain("$env:E2E_SERVER_MODE = 'production'");
    expect(script).toContain("$env:LOCAL_RUNTIME_MODE = '1'");
    expect(script).toContain("$env:AI_ADAPTER = 'test'");
    expect(script).toContain("$env:EXPECTED_MIGRATION_COUNT = [string]$migrationCount");
    expect(script).toContain("reset-e2e-database.ts");
    expect(script.match(/reset-e2e-database\.ts/g)).toHaveLength(2);
    expect(script.match(/pnpm\.cmd db:migrate/g)).toHaveLength(2);
    expect(script.match(/pnpm\.cmd db:seed/g)).toHaveLength(2);
    expect(script).toMatch(/database name must end with _e2e, _test, or _testing/i);

    const commands = [
      "pnpm.cmd lint",
      "pnpm.cmd typecheck",
      "reset-e2e-database.ts",
      "pnpm.cmd db:migrate",
      "pnpm.cmd db:seed",
      "pnpm.cmd test",
      "pnpm.cmd build",
      "pnpm.cmd build:worker",
      "pnpm.cmd e2e",
    ];
    let previousIndex = -1;
    for (const command of commands) {
      const commandIndex = script.indexOf(command);
      expect(commandIndex, `${command} must exist and preserve release-gate order`).toBeGreaterThan(previousIndex);
      previousIndex = commandIndex;
    }
  });

  test("documents the runnable Windows gate and current migration count", async () => {
    const [docs, workflow] = await Promise.all([
      readFile("docs/deployment.md", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);
    expect(docs).toContain("EXPECTED_MIGRATION_COUNT=19");
    expect(workflow).toContain('EXPECTED_MIGRATION_COUNT: "19"');
    expect(docs).toContain("scripts/verify-release.ps1");
    expect(docs).toContain("E2E_DATABASE_URL");
    expect(docs).toContain("Playwright");
    expect(docs).toContain("3101");
    expect(docs).toContain("清空 `drizzle` 迁移账本与该测试库的 `public` schema");
  });

  test("starts E2E on a dedicated port and never reuses an existing server", async () => {
    const config = await readFile("playwright.config.ts", "utf8");

    expect(config).toContain('"http://localhost:3101"');
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("const port = new URL(baseURL).port || \"3101\"");
    expect(config).toContain("PORT: port");
    expect(config).toContain("APP_URL: baseURL");
    expect(config).toContain('process.env.E2E_SERVER_MODE === "production"');
    expect(config).toContain('"node --env-file=.env.local scripts/start-production.mjs"');
  });

  test("resets both application tables and Drizzle migration metadata before a fresh migration", async () => {
    const resetScript = await readFile("scripts/reset-e2e-database.ts", "utf8");

    expect(resetScript).toContain("assertIsolatedE2eDatabaseUrl(connectionString)");
    expect(resetScript).toContain('DROP SCHEMA IF EXISTS public CASCADE');
    expect(resetScript).toContain('DROP SCHEMA IF EXISTS drizzle CASCADE');
    expect(resetScript.indexOf("DROP SCHEMA IF EXISTS drizzle CASCADE")).toBeLessThan(
      resetScript.indexOf("DROP SCHEMA IF EXISTS public CASCADE"),
    );
    expect(resetScript.indexOf("DROP SCHEMA IF EXISTS public CASCADE")).toBeLessThan(
      resetScript.indexOf("CREATE SCHEMA public"),
    );
  });
});
