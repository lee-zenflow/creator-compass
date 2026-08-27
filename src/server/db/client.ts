import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const localDatabaseUrl =
  "postgresql://creator_compass:change-me@localhost:5432/creator_compass";

const connectionString = process.env.DATABASE_URL ?? localDatabaseUrl;

const globalForDatabase = globalThis as typeof globalThis & {
  creatorCompassPool?: Pool;
};

export const pool =
  globalForDatabase.creatorCompassPool ??
  new Pool({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 20 : 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.creatorCompassPool = pool;
}

export const db = drizzle({ client: pool, schema });

export type CreatorCompassDatabase = typeof db;

export async function closeDatabase() {
  await pool.end();
  globalForDatabase.creatorCompassPool = undefined;
}
