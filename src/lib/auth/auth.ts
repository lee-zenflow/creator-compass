import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { assertSessionUserActive } from "@/features/identity/account-policy";
import {
  AUTH_RATE_LIMIT_OPTIONS,
  LOCAL_EMAIL_PASSWORD_OPTIONS,
  parseTrustedProxies,
} from "@/lib/auth/auth-policy";
import { db } from "@/server/db/client";
import {
  accounts,
  BETTER_AUTH_DATABASE_ID_GENERATION,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";

const applicationUrl = process.env.APP_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName: "Creator Compass",
  baseURL: applicationUrl,
  basePath: "/api/auth",
  secret: process.env.AUTH_SECRET,
  trustedOrigins: [new URL(applicationUrl).origin],
  database: drizzleAdapter(db, {
    provider: "pg",
    transaction: true,
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  user: {
    additionalFields: {
      role: {
        type: ["user", "admin"],
        required: true,
        input: false,
        defaultValue: "user",
      },
      accountStatus: {
        type: ["active", "suspended", "deleted"],
        required: true,
        input: false,
        defaultValue: "active",
      },
    },
  },
  emailAndPassword: LOCAL_EMAIL_PASSWORD_OPTIONS,
  advanced: {
    database: { generateId: BETTER_AUTH_DATABASE_ID_GENERATION },
    useSecureCookies: process.env.NODE_ENV === "production",
    disableCSRFCheck: false,
    disableOriginCheck: false,
    ipAddress: {
      trustedProxies: parseTrustedProxies(process.env.AUTH_TRUSTED_PROXIES),
    },
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    ...AUTH_RATE_LIMIT_OPTIONS,
  },
  databaseHooks: {
    session: {
      create: {
        async before(session) {
          await assertSessionUserActive(session.userId);
        },
      },
    },
  },
  plugins: [nextCookies()],
});
