import { Client } from "pg";

import { assertIsolatedE2eDatabaseUrl } from "../src/server/release/e2e-isolation";

async function resetE2eDatabase() {
  const connectionString = process.env.E2E_DATABASE_URL;
  if (!connectionString) {
    throw new Error("E2E_DATABASE_URL is required.");
  }

  assertIsolatedE2eDatabaseUrl(connectionString);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  } finally {
    await client.end();
  }
}

resetE2eDatabase().catch((error: unknown) => {
  console.error("E2E database reset failed.", error);
  process.exitCode = 1;
});
