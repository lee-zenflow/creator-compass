import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

// Task 3 must pass this value to Better Auth's advanced.database.generateId.
// Better Auth 1.6.26 maps this setting to PostgreSQL uuid ids and foreign keys.
export const BETTER_AUTH_DATABASE_ID_GENERATION = "uuid" as const;

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const accountStatus = pgEnum("account_status", ["active", "suspended", "deleted"]);

export const users = pgTable(
  "user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: userRole("role").default("user").notNull(),
    accountStatus: accountStatus("account_status").default("active").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_token_idx").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const accounts = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounts_provider_account_idx").on(table.providerId, table.accountId),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    convertedToUserId: uuid("converted_to_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    aiQuotaUsed: integer("ai_quota_used").default(0).notNull(),
    aiQuotaLimit: integer("ai_quota_limit").default(12).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("guest_sessions_token_hash_idx").on(table.tokenHash),
    index("guest_sessions_converted_user_idx").on(table.convertedToUserId),
    index("guest_sessions_expires_at_idx").on(table.expiresAt),
    check(
      "guest_sessions_ai_quota_range",
      sql`${table.aiQuotaUsed} >= 0 and ${table.aiQuotaLimit} >= 0 and ${table.aiQuotaUsed} <= ${table.aiQuotaLimit}`,
    ),
    check(
      "guest_sessions_conversion_pair",
      sql`(${table.convertedToUserId} is null) = (${table.convertedAt} is null)`,
    ),
  ],
);

export const localInstance = pgTable(
  "local_instance",
  {
    singletonKey: text("singleton_key").primaryKey().default("owner"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    initializedAt: timestamp("initialized_at", { withTimezone: true }).defaultNow().notNull(),
    productVersion: text("product_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("local_instance_owner_unique_idx").on(table.ownerUserId),
    check("local_instance_singleton_key", sql`${table.singletonKey} = 'owner'`),
  ],
);

export const ownerRecoveryCodes = pgTable(
  "owner_recovery_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("owner_recovery_codes_hash_unique_idx").on(table.codeHash),
    index("owner_recovery_codes_user_available_idx").on(table.userId, table.consumedAt),
  ],
);

export const deepseekCredentials = pgTable(
  "deepseek_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    envelopeVersion: integer("envelope_version").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    lastFour: text("last_four").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    testedAt: timestamp("tested_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("deepseek_credentials_envelope_version_positive", sql`${table.envelopeVersion} > 0`),
    check("deepseek_credentials_last_four_length", sql`char_length(${table.lastFour}) = 4`),
  ],
);

export const AUTH_TABLES = {
  accounts,
  sessions,
  users,
  verifications,
} as const;

export const LOCAL_SECURITY_TABLES = {
  deepseekCredentials,
  localInstance,
  ownerRecoveryCodes,
} as const;
