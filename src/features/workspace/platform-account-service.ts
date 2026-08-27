import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { platformAccounts } from "@/server/db/schema";

const accountInputSchema = z.object({
  platform: z.string().trim().min(1).max(64),
  accountLabel: z.string().trim().min(1).max(80),
  dataSource: z.enum(["manual", "ocr"]),
}).strict();

export interface PlatformAccountRepository {
  transaction<T>(work: (repository: PlatformAccountRepository) => Promise<T>): Promise<T>;
  lockOwner(actor: CurrentActor): Promise<void>;
  findActive(actor: CurrentActor): Promise<{ id: string } | null>;
  list(actor: CurrentActor): Promise<Array<{ id: string; platform: string; accountLabel: string | null; dataSource: string; isActive: boolean }>>;
  create(actor: CurrentActor, input: z.output<typeof accountInputSchema> & { isActive: boolean }): Promise<{ id: string }>;
  findOwned(actor: CurrentActor, accountId: string): Promise<{ id: string } | null>;
  deactivateAll(actor: CurrentActor): Promise<void>;
  activate(actor: CurrentActor, accountId: string): Promise<void>;
}

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}
function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}
function ownerKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

function createDatabasePlatformAccountRepository(database: CreatorCompassDatabase): PlatformAccountRepository {
  return {
    transaction(work) {
      return database.transaction((tx) => work(createDatabasePlatformAccountRepository(tx as unknown as CreatorCompassDatabase)));
    },
    async lockOwner(actor) {
      await database.execute(sql`select pg_advisory_xact_lock(hashtext(${`platform-account:${ownerKey(actor)}`}))`);
    },
    async findActive(actor) {
      const [row] = await database.select({ id: platformAccounts.id }).from(platformAccounts)
        .where(and(actorWhere(actor, platformAccounts), eq(platformAccounts.isActive, true))).limit(1);
      return row ?? null;
    },
    async list(actor) {
      return database.select({ id: platformAccounts.id, platform: platformAccounts.platform, accountLabel: platformAccounts.accountLabel, dataSource: platformAccounts.dataSource, isActive: platformAccounts.isActive })
        .from(platformAccounts).where(actorWhere(actor, platformAccounts))
        .orderBy(desc(platformAccounts.isActive), desc(platformAccounts.updatedAt));
    },
    async create(actor, input) {
      const [row] = await database.insert(platformAccounts).values({ ...ownerValues(actor), ...input })
        .returning({ id: platformAccounts.id });
      if (!row) throw new Error("PLATFORM_ACCOUNT_CREATE_FAILED");
      return row;
    },
    async findOwned(actor, accountId) {
      const [row] = await database.select({ id: platformAccounts.id }).from(platformAccounts)
        .where(and(eq(platformAccounts.id, accountId), actorWhere(actor, platformAccounts))).limit(1).for("update");
      return row ?? null;
    },
    async deactivateAll(actor) {
      await database.update(platformAccounts).set({ isActive: false, updatedAt: new Date() })
        .where(actorWhere(actor, platformAccounts));
    },
    async activate(actor, accountId) {
      const rows = await database.update(platformAccounts).set({ isActive: true, updatedAt: new Date() })
        .where(and(eq(platformAccounts.id, accountId), actorWhere(actor, platformAccounts)))
        .returning({ id: platformAccounts.id });
      if (rows.length !== 1) throw new Error("PLATFORM_ACCOUNT_NOT_FOUND");
    },
  };
}

export const databasePlatformAccountRepository = createDatabasePlatformAccountRepository(db);

export async function createPlatformAccountLabel(
  actor: CurrentActor,
  input: z.input<typeof accountInputSchema>,
  repository = databasePlatformAccountRepository,
) {
  const parsed = accountInputSchema.parse(input);
  return repository.transaction(async (tx) => {
    await tx.lockOwner(actor);
    const active = await tx.findActive(actor);
    return tx.create(actor, { ...parsed, isActive: !active });
  });
}

export async function setActivePlatformAccount(
  actor: CurrentActor,
  accountId: string,
  repository = databasePlatformAccountRepository,
) {
  const id = z.uuid().parse(accountId);
  return repository.transaction(async (tx) => {
    await tx.lockOwner(actor);
    if (!await tx.findOwned(actor, id)) throw new Error("PLATFORM_ACCOUNT_NOT_FOUND");
    await tx.deactivateAll(actor);
    await tx.activate(actor, id);
  });
}

export function listPlatformAccountLabels(
  actor: CurrentActor,
  repository = databasePlatformAccountRepository,
) {
  return repository.list(actor);
}
