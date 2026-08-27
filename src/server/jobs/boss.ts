import { PgBoss } from "pg-boss";

let boss: PgBoss | null = null;
const localDatabaseUrl = "postgresql://creator_compass:change-me@localhost:5432/creator_compass";

export function getBoss() {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL ?? localDatabaseUrl,
      application_name: "creator-compass-ai-worker",
    });
    boss.on("error", () => {
      // pg-boss emits operational errors. Avoid logging raw database details here.
    });
  }
  return boss;
}

export async function startBoss() {
  return getBoss().start();
}

export async function stopBoss() {
  if (!boss) return;
  const active = boss;
  boss = null;
  await active.stop({ graceful: true, timeout: 30_000, close: true });
}
