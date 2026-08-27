import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Windows local launcher contract", () => {
  test("starts PostgreSQL in a hidden detached process", () => {
    const script = readFileSync("scripts/start-local-product.ps1", "utf8");

    expect(script).toContain("$postgres = Start-Process");
    expect(script).toContain("-WindowStyle Hidden");
    expect(script).toContain("$postgres.WaitForExit()");
    expect(script).not.toContain("-Wait");
    expect(script).not.toMatch(/& \(Join-Path \$PostgresRoot "bin\\pg_ctl\.exe"\).* start/);
  });

  test("derives the expected migration count for the launched runtime", () => {
    const script = readFileSync("scripts/start-local-product.ps1", "utf8");

    expect(script).toContain("$env:EXPECTED_MIGRATION_COUNT = [string]$migrationCount");
    expect(script).toMatch(/Get-ChildItem.+drizzle.+\*\.sql/);
  });
});
