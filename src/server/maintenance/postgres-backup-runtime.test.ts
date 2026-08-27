import { describe, expect, test } from "vitest";

import { portableTableNames, rewriteBackupStateForOwner } from "./postgres-backup-runtime";

const source = "10000000-0000-4000-8000-000000000001";
const target = "20000000-0000-4000-8000-000000000002";

describe("PostgreSQL backup runtime", () => {
  test("backs up product data but never local credentials, sessions, recovery codes, or runtime state", () => {
    expect(portableTableNames).toContain("reports");
    expect(portableTableNames).toContain("knowledge_items");
    expect(portableTableNames).not.toEqual(expect.arrayContaining([
      "user", "account", "session", "verification", "guest_sessions", "local_instance",
      "owner_recovery_codes", "deepseek_credentials", "runtime_heartbeats",
    ]));
  });

  test("remaps the source Owner in both SQL and actor-scoped private file paths", () => {
    const state = rewriteBackupStateForOwner({
      sourceOwnerId: source,
      files: [
        { path: "database.sql", data: new TextEncoder().encode(`INSERT INTO reports VALUES ('${source}');`) },
        { path: `private/user/${source}/source.txt`, data: new TextEncoder().encode("body") },
      ],
    }, target);

    expect(new TextDecoder().decode(state.files[0]!.data)).toContain(target);
    expect(state.files[1]!.path).toBe(`private/user/${target}/source.txt`);
    expect(state.sourceOwnerId).toBe(target);
  });

  test("rejects malformed Owner identifiers before rewriting SQL", () => {
    expect(() => rewriteBackupStateForOwner({ sourceOwnerId: "bad", files: [] }, target)).toThrow("BACKUP_OWNER_INVALID");
  });
});
