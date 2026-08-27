import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth/auth";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export type CurrentActor =
  | { kind: "guest"; guestSessionId: string }
  | { kind: "user"; userId: string; role: "user" | "admin" };

export type UserIdentity = {
  id: string;
  emailVerified: boolean;
  role: "user" | "admin";
  accountStatus: "active" | "suspended" | "deleted";
};

type CookieStore = {
  get(name: string): { value: string } | undefined;
};

export interface ActorIdentityRepository {
  getSessionUserId(headers: Headers): Promise<string | null>;
  findUserIdentity(userId: string): Promise<UserIdentity | null>;
}

const databaseActorIdentityRepository: ActorIdentityRepository = {
  async getSessionUserId(headers) {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  },
  async findUserIdentity(userId) {
    const [identity] = await db
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
        role: users.role,
        accountStatus: users.accountStatus,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return identity ?? null;
  },
};

export async function resolveCurrentActor(
  headers: Headers,
  _cookies: CookieStore,
  repository: ActorIdentityRepository = databaseActorIdentityRepository,
): Promise<CurrentActor> {
  const sessionUserId = await repository.getSessionUserId(headers);
  if (sessionUserId) {
    const identity = await repository.findUserIdentity(sessionUserId);
    if (!identity || !identity.emailVerified || identity.accountStatus !== "active") {
      throw new Error("UNAUTHORIZED");
    }
    return { kind: "user", userId: identity.id, role: identity.role };
  }

  throw new Error("UNAUTHORIZED");
}

export { assertSessionUserActive } from "./account-policy";

export function assertOwnedBy(
  actor: CurrentActor,
  owner: { userId: string | null; guestSessionId: string | null },
) {
  const owned =
    actor.kind === "user"
      ? owner.userId === actor.userId && owner.guestSessionId === null
      : owner.guestSessionId === actor.guestSessionId && owner.userId === null;
  if (!owned) throw new Error("FORBIDDEN");
}
