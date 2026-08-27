import { and, eq, gt, isNull, sql } from "drizzle-orm";

import {
  GUEST_COOKIE_NAME,
  clearGuestCookie,
  hashGuestToken,
  readCookieToken,
} from "@/lib/auth/guest-token";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { ACTOR_OWNED_TABLES, guestSessions } from "@/server/db/schema";

export type MergeUserIdentity = {
  id: string;
  emailVerified: boolean;
  role: "user" | "admin";
  accountStatus: "active" | "suspended" | "deleted";
};

export type GuestSessionForMerge = {
  id: string;
  convertedToUserId: string | null;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
};

export type SingletonDraft = Record<string, unknown>;

export const ACTOR_OWNED_TABLE_NAMES = Object.keys(ACTOR_OWNED_TABLES) as Array<
  keyof typeof ACTOR_OWNED_TABLES
>;

export const GUEST_SINGLETON_TABLES = ["creatorProfiles", "userSettings"] as const;
export const GUEST_LIST_TABLES = [
  "aiRuns",
  "contentPlans",
  "creationProjects",
  "creatorProfileVersions",
  "materialReferences",
  "materials",
  "platformAccounts",
  "positioningReports",
  "positioningSessions",
  "productEvents",
  "reports",
  "retrievalRecords",
  "reviewReports",
  "reviews",
  "tasks",
] as const;

type SingletonTable = (typeof GUEST_SINGLETON_TABLES)[number];
type ListTable = (typeof GUEST_LIST_TABLES)[number];

export interface GuestMergeTransaction {
  deferAllConstraints(): Promise<void>;
  lockGuestSession(guestSessionId: string): Promise<GuestSessionForMerge | null>;
  findUserIdentity(userId: string): Promise<MergeUserIdentity | null>;
  findSingleton(
    table: SingletonTable,
    owner: "guest" | "user",
    ownerId: string,
  ): Promise<SingletonDraft | null>;
  moveSingletonToUser(table: SingletonTable, guestSessionId: string, userId: string): Promise<void>;
  preserveSingletonConflict(
    table: SingletonTable,
    guestDraft: SingletonDraft,
    guestSessionId: string,
    userId: string,
  ): Promise<void>;
  resolvePlatformAccountActiveConflict(guestSessionId: string, userId: string): Promise<void>;
  moveListTableToUser(table: ListTable, guestSessionId: string, userId: string): Promise<void>;
  revokeGuest(guestSessionId: string, userId: string): Promise<void>;
}

export interface GuestMergeRepository {
  transaction<T>(operation: (tx: GuestMergeTransaction) => Promise<T>): Promise<T>;
}

function timestampMilliseconds(value: Date | string) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("GUEST_SESSION_TIMESTAMP_INVALID");
  return milliseconds;
}

const SQL_TABLE_NAMES: Record<SingletonTable | ListTable, string> = {
  aiRuns: "ai_runs",
  contentPlans: "content_plans",
  creationProjects: "creation_projects",
  creatorProfileVersions: "creator_profile_versions",
  creatorProfiles: "creator_profiles",
  materialReferences: "material_references",
  materials: "materials",
  platformAccounts: "platform_accounts",
  positioningReports: "positioning_reports",
  positioningSessions: "positioning_sessions",
  productEvents: "product_events",
  reports: "reports",
  retrievalRecords: "retrieval_records",
  reviewReports: "review_reports",
  reviews: "reviews",
  tasks: "tasks",
  userSettings: "user_settings",
};

type DatabaseTransaction = Parameters<
  Parameters<CreatorCompassDatabase["transaction"]>[0]
>[0];

class PostgresGuestMergeTransaction implements GuestMergeTransaction {
  constructor(private readonly tx: DatabaseTransaction) {}

  async deferAllConstraints() {
    await this.tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
  }

  async lockGuestSession(guestSessionId: string) {
    const result = await this.tx.execute<{
      id: string;
      converted_to_user_id: string | null;
      revoked_at: Date | null;
      expires_at: Date;
    }>(sql`
      select id, converted_to_user_id, revoked_at, expires_at
      from guest_sessions
      where id = ${guestSessionId}
      for update
    `);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          convertedToUserId: row.converted_to_user_id,
          revokedAt: row.revoked_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async findUserIdentity(userId: string) {
    const result = await this.tx.execute<{
      id: string;
      email_verified: boolean;
      role: "user" | "admin";
      account_status: "active" | "suspended" | "deleted";
    }>(sql`
      select id, email_verified, role, account_status
      from "user"
      where id = ${userId}
      limit 1
    `);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          emailVerified: row.email_verified,
          role: row.role,
          accountStatus: row.account_status,
        }
      : null;
  }

  async findSingleton(table: SingletonTable, owner: "guest" | "user", ownerId: string) {
    const column = owner === "guest" ? "guest_session_id" : "user_id";
    if (table === "creatorProfiles") {
      const result = await this.tx.execute<{ draft: SingletonDraft }>(sql`
        select jsonb_set(
          to_jsonb(record) - 'user_id' - 'guest_session_id',
          '{profileVersions}',
          coalesce((
            select jsonb_agg(
              to_jsonb(version_record) - 'user_id' - 'guest_session_id'
              order by version_record.version
            )
            from creator_profile_versions as version_record
            where version_record.creator_profile_id = record.id
          ), '[]'::jsonb),
          true
        ) as draft
        from creator_profiles as record
        where ${sql.identifier(column)} = ${ownerId}
        limit 1
      `);
      return result.rows[0]?.draft ?? null;
    }
    const result = await this.tx.execute<{ draft: SingletonDraft }>(sql`
      select to_jsonb(record) - 'user_id' - 'guest_session_id' as draft
      from ${sql.identifier(SQL_TABLE_NAMES[table])} as record
      where ${sql.identifier(column)} = ${ownerId}
      limit 1
    `);
    return result.rows[0]?.draft ?? null;
  }

  async moveSingletonToUser(table: SingletonTable, guestSessionId: string, userId: string) {
    await this.tx.execute(sql`
      update ${sql.identifier(SQL_TABLE_NAMES[table])}
      set user_id = ${userId}, guest_session_id = null, updated_at = now()
      where guest_session_id = ${guestSessionId}
    `);
  }

  async preserveSingletonConflict(
    table: SingletonTable,
    guestDraft: SingletonDraft,
    guestSessionId: string,
    userId: string,
  ) {
    await this.tx.execute(sql`
      update ${sql.identifier(SQL_TABLE_NAMES[table])}
      set guest_draft = ${JSON.stringify(guestDraft)}::jsonb,
          merge_state = 'guest_conflict',
          source_guest_session_id = ${guestSessionId},
          updated_at = now()
      where user_id = ${userId}
    `);
    await this.tx.execute(sql`
      delete from ${sql.identifier(SQL_TABLE_NAMES[table])}
      where guest_session_id = ${guestSessionId}
    `);
  }

  async resolvePlatformAccountActiveConflict(guestSessionId: string, userId: string) {
    await this.tx.execute(sql`
      update platform_accounts
      set is_active = false, updated_at = now()
      where guest_session_id = ${guestSessionId}
        and is_active = true
        and exists (
          select 1 from platform_accounts
          where user_id = ${userId} and is_active = true
        )
    `);
  }

  async moveListTableToUser(table: ListTable, guestSessionId: string, userId: string) {
    await this.tx.execute(sql`
      update ${sql.identifier(SQL_TABLE_NAMES[table])}
      set user_id = ${userId}, guest_session_id = null, updated_at = now()
      where guest_session_id = ${guestSessionId}
    `);
  }

  async revokeGuest(guestSessionId: string, userId: string) {
    await this.tx.execute(sql`
      update guest_sessions
      set converted_to_user_id = ${userId},
          converted_at = now(),
          revoked_at = now(),
          updated_at = now()
      where id = ${guestSessionId}
    `);
  }
}

export const postgresGuestMergeRepository: GuestMergeRepository = {
  transaction(operation) {
    return db.transaction((tx) => operation(new PostgresGuestMergeTransaction(tx)));
  },
};

export async function mergeGuestIntoUser(
  guestSessionId: string,
  userId: string,
  repository: GuestMergeRepository = postgresGuestMergeRepository,
) {
  return repository.transaction(async (tx) => {
    await tx.deferAllConstraints();
    const guest = await tx.lockGuestSession(guestSessionId);
    if (!guest) throw new Error("GUEST_SESSION_NOT_FOUND");

    if (guest.convertedToUserId || guest.revokedAt) {
      if (guest.convertedToUserId === userId && guest.revokedAt) return;
      throw new Error("GUEST_SESSION_ALREADY_CONVERTED");
    }
    if (timestampMilliseconds(guest.expiresAt) <= Date.now()) throw new Error("GUEST_SESSION_EXPIRED");

    const user = await tx.findUserIdentity(userId);
    if (!user) throw new Error("UNAUTHORIZED");
    if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");
    if (user.accountStatus !== "active") throw new Error("ACCOUNT_INACTIVE");

    for (const table of GUEST_SINGLETON_TABLES) {
      const guestDraft = await tx.findSingleton(table, "guest", guestSessionId);
      if (!guestDraft) continue;
      const existingUserValue = await tx.findSingleton(table, "user", userId);
      if (existingUserValue) {
        await tx.preserveSingletonConflict(table, guestDraft, guestSessionId, userId);
      } else {
        await tx.moveSingletonToUser(table, guestSessionId, userId);
      }
    }

    await tx.resolvePlatformAccountActiveConflict(guestSessionId, userId);
    for (const table of GUEST_LIST_TABLES) {
      await tx.moveListTableToUser(table, guestSessionId, userId);
    }

    await tx.revokeGuest(guestSessionId, userId);
  });
}

export async function mergeGuestTokenIntoUser(token: string, userId: string) {
  const [guest] = await db
    .select({ id: guestSessions.id })
    .from(guestSessions)
    .where(
      and(
        eq(guestSessions.tokenHash, hashGuestToken(token)),
        isNull(guestSessions.revokedAt),
        gt(guestSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!guest) return false;
  await mergeGuestIntoUser(guest.id, userId);
  return true;
}

export async function mergeGuestOnSessionCreation(
  cookieHeader: string | null,
  userId: string,
  mergeToken: (token: string, userId: string) => Promise<boolean> = mergeGuestTokenIntoUser,
  setCookie?: (
    name: string,
    value: string,
    options: Omit<ReturnType<typeof clearGuestCookie>, "name" | "value">,
  ) => unknown,
  production = process.env.NODE_ENV === "production",
) {
  const token = readCookieToken(cookieHeader);
  if (!token) return false;
  const merged = await mergeToken(token, userId);
  if (setCookie) {
    const expiredCookie = clearGuestCookie(production);
    setCookie(GUEST_COOKIE_NAME, "", {
      httpOnly: expiredCookie.httpOnly,
      sameSite: expiredCookie.sameSite,
      path: expiredCookie.path,
      secure: expiredCookie.secure,
      maxAge: expiredCookie.maxAge,
    });
  }
  return merged;
}
