import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pathToFileURL } from "node:url";

import { closeDatabase, db } from "./client";

export async function migrateDatabase() {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateDatabase()
    .then(() => {
      console.info("Database migrations applied.");
    })
    .catch((error: unknown) => {
      console.error("Database migration failed.", error);
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
