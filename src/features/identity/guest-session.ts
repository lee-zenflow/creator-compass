import { and, eq, gt, isNull } from "drizzle-orm";

import { mergeGuestTokenIntoUser } from "./merge-guest";
import { auth } from "@/lib/auth/auth";
import {
  GUEST_COOKIE_NAME,
  GUEST_SESSION_TTL_SECONDS,
  createGuestCookie,
  createGuestToken,
  hashGuestToken,
  type GuestCookie,
} from "@/lib/auth/guest-token";
import { db } from "@/server/db/client";
import { guestSessions } from "@/server/db/schema";

type CookieStore = {
  get(name: string): { value: string } | undefined;
};

export interface GuestTrialRepository {
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<{ id: string } | null>;
  create(input: { tokenHash: string; expiresAt: Date }): Promise<{ id: string }>;
}

const databaseGuestTrialRepository: GuestTrialRepository = {
  async findActiveByTokenHash(tokenHash, now) {
    const [row] = await db
      .select({ id: guestSessions.id })
      .from(guestSessions)
      .where(
        and(
          eq(guestSessions.tokenHash, tokenHash),
          isNull(guestSessions.revokedAt),
          gt(guestSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  },
  async create(input) {
    const [row] = await db
      .insert(guestSessions)
      .values(input)
      .returning({ id: guestSessions.id });
    if (!row) throw new Error("GUEST_SESSION_CREATE_FAILED");
    return row;
  },
};

export async function startGuestTrial(
  repository: GuestTrialRepository = databaseGuestTrialRepository,
  now = new Date(),
  production = process.env.NODE_ENV === "production",
): Promise<{ guestSessionId: string; cookie: GuestCookie }> {
  const token = createGuestToken();
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_SECONDS * 1000);
  const guest = await repository.create({ tokenHash: hashGuestToken(token), expiresAt });
  return { guestSessionId: guest.id, cookie: createGuestCookie(token, production) };
}

export async function ensureGuestTrial(
  existingToken: string | null,
  repository: GuestTrialRepository = databaseGuestTrialRepository,
  now = new Date(),
  production = process.env.NODE_ENV === "production",
) {
  if (existingToken) {
    const active = await repository.findActiveByTokenHash(hashGuestToken(existingToken), now);
    if (active) {
      return {
        guestSessionId: active.id,
        cookie: createGuestCookie(existingToken, production),
        created: false,
      } as const;
    }
  }
  return { ...(await startGuestTrial(repository, now, production)), created: true } as const;
}

export interface AuthenticatedGuestMergeDependencies {
  getSessionUserId(headers: Headers): Promise<string | null>;
  mergeGuestTokenIntoUser(token: string, userId: string): Promise<boolean>;
}

const authenticatedMergeDependencies: AuthenticatedGuestMergeDependencies = {
  async getSessionUserId(headers) {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  },
  mergeGuestTokenIntoUser,
};

export async function mergeGuestForAuthenticatedRequest(
  headers: Headers,
  cookies: CookieStore,
  dependencies: AuthenticatedGuestMergeDependencies = authenticatedMergeDependencies,
) {
  const userId = await dependencies.getSessionUserId(headers);
  if (!userId) throw new Error("UNAUTHORIZED");
  const token = cookies.get(GUEST_COOKIE_NAME)?.value;
  if (!token) return false;
  return dependencies.mergeGuestTokenIntoUser(token, userId);
}
