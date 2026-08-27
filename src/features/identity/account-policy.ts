import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export type AccountIdentity = {
  id: string;
  emailVerified: boolean;
  role: "user" | "admin";
  accountStatus: "active" | "suspended" | "deleted";
};

export interface AccountIdentityRepository {
  findUserIdentity(userId: string): Promise<AccountIdentity | null>;
}

const databaseAccountIdentityRepository: AccountIdentityRepository = {
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

export async function assertSessionUserActive(
  userId: string,
  repository: AccountIdentityRepository = databaseAccountIdentityRepository,
) {
  const identity = await repository.findUserIdentity(userId);
  if (!identity) throw new Error("UNAUTHORIZED");
  if (!identity.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");
  if (identity.accountStatus !== "active") throw new Error("ACCOUNT_INACTIVE");
  return identity;
}
