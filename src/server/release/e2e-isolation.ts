const isolatedDatabaseSuffix = /_(?:e2e|test|testing)$/i;

export function assertIsolatedE2eDatabaseUrl(value: string): { databaseName: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("E2E_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("E2E_DATABASE_URL must use the postgresql:// or postgres:// scheme.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!isolatedDatabaseSuffix.test(databaseName)) {
    throw new Error("E2E_DATABASE_URL database name must end with _e2e, _test, or _testing.");
  }

  return { databaseName };
}

export function assertReleaseE2eEnvironment(input: {
  databaseUrl: string;
  baseUrl: string;
  serverMode: string | undefined;
  localRuntimeMode: string | undefined;
}) {
  const database = assertIsolatedE2eDatabaseUrl(input.databaseUrl);
  if (input.baseUrl !== "http://localhost:3101") {
    throw new Error("E2E_BASE_URL must be http://localhost:3101 for release verification.");
  }
  if (input.serverMode !== "production") {
    throw new Error("E2E_SERVER_MODE must be production for release verification.");
  }
  if (input.localRuntimeMode !== "1") {
    throw new Error("LOCAL_RUNTIME_MODE must be 1 for isolated release verification.");
  }
  return database;
}
