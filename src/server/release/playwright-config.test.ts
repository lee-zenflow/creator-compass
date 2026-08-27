import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { assertReleaseE2eEnvironment } from "./e2e-isolation";

describe("release Playwright isolation", () => {
  test("rejects a production-looking database before Playwright can start", async () => {
    expect(() => assertReleaseE2eEnvironment({
      databaseUrl: "postgresql://tester:secret@db.example.com:5432/creator_compass",
      baseUrl: "http://localhost:3101",
      serverMode: "production",
      localRuntimeMode: "1",
    })).toThrow("database name must end with _e2e, _test, or _testing");
  });

  test("requires the release origin and production server mode", async () => {
    const databaseUrl = "postgresql://tester:secret@127.0.0.1:5432/creator_compass_e2e";
    expect(() => assertReleaseE2eEnvironment({
      databaseUrl,
      baseUrl: "http://127.0.0.1:3101",
      serverMode: "production",
      localRuntimeMode: "1",
    })).toThrow("E2E_BASE_URL must be http://localhost:3101");
    expect(() => assertReleaseE2eEnvironment({
      databaseUrl,
      baseUrl: "http://localhost:3101",
      serverMode: "development",
      localRuntimeMode: "1",
    })).toThrow("E2E_SERVER_MODE must be production");
  });

  test("requires an explicit local runtime for the test adapter", async () => {
    expect(() => assertReleaseE2eEnvironment({
      databaseUrl: "postgresql://tester:secret@127.0.0.1:5432/creator_compass_e2e",
      baseUrl: "http://localhost:3101",
      serverMode: "production",
      localRuntimeMode: "0",
    })).toThrow("LOCAL_RUNTIME_MODE must be 1");
  });

  test("never reuses an existing server for an isolated release run", async () => {
    const config = await readFile("playwright.config.ts", "utf8");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain('baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101"');
    expect(config).toContain('AI_ADAPTER: "test"');
    expect(config).toContain("...process.env");
    expect(config).toContain("localRuntimeMode: process.env.LOCAL_RUNTIME_MODE");
  });
});
