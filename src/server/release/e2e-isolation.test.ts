import { describe, expect, test } from "vitest";

import { assertIsolatedE2eDatabaseUrl } from "./e2e-isolation";

describe("assertIsolatedE2eDatabaseUrl", () => {
  test("accepts a PostgreSQL URL whose database has an explicit e2e suffix", () => {
    expect(assertIsolatedE2eDatabaseUrl("postgresql://tester:secret@127.0.0.1:5432/creator_compass_e2e")).toEqual({
      databaseName: "creator_compass_e2e",
    });
  });

  test("rejects a production-looking database name before any destructive reset", () => {
    expect(() => assertIsolatedE2eDatabaseUrl("postgresql://tester:secret@db.example.com:5432/creator_compass")).toThrow(
      "database name must end with _e2e, _test, or _testing",
    );
  });

  test("rejects non-PostgreSQL URLs", () => {
    expect(() => assertIsolatedE2eDatabaseUrl("mysql://tester:secret@127.0.0.1:3306/creator_compass_e2e")).toThrow(
      "must use the postgresql:// or postgres:// scheme",
    );
  });
});
