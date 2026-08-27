import { createHash, randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  accounts,
  localInstance,
  ownerRecoveryCodes,
  sessions,
  users,
} from "@/server/db/schema";

export const LOCAL_OWNER_EMAIL = "owner@creator-compass.local";
const RECOVERY_CODE_COUNT = 8;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

type OwnerInstance = { userId: string; username: string };

export interface LocalOwnerRepository {
  getInstance(): Promise<OwnerInstance | null>;
  createOwner(input: {
    username: string;
    email: typeof LOCAL_OWNER_EMAIL;
    emailVerified: true;
    role: "admin";
    accountStatus: "active";
    passwordHash: string;
    recoveryCodeHashes: string[];
    productVersion: string;
  }): Promise<{ userId: string }>;
  consumeRecoveryCode(input: {
    codeHash: string;
    passwordHash: string;
  }): Promise<{ userId: string } | null>;
}

type LocalOwnerDependencies = {
  hashPassword(password: string): Promise<string>;
  generateRecoveryCodes(): string[];
  hashRecoveryCode(code: string): string;
  productVersion: string;
};

function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase();
}

export function hashOwnerRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}

export function generateOwnerRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const value = randomBytes(8).toString("hex").toUpperCase();
    return `CC-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
  });
}

const defaultDependencies: LocalOwnerDependencies = {
  hashPassword,
  generateRecoveryCodes: generateOwnerRecoveryCodes,
  hashRecoveryCode: hashOwnerRecoveryCode,
  productVersion: process.env.APP_VERSION ?? "local",
};

function validateUsername(username: string) {
  const normalized = username.trim();
  if (normalized.length < 1 || normalized.length > 40) {
    throw new Error("OWNER_USERNAME_INVALID");
  }
  return normalized;
}

function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("OWNER_PASSWORD_INVALID");
  }
  return password;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "23505"
  );
}

export const databaseLocalOwnerRepository: LocalOwnerRepository = {
  async getInstance() {
    const [instance] = await db
      .select({ userId: localInstance.ownerUserId, username: users.name })
      .from(localInstance)
      .innerJoin(users, eq(users.id, localInstance.ownerUserId))
      .where(eq(localInstance.singletonKey, "owner"))
      .limit(1);
    return instance ?? null;
  },
  async createOwner(input) {
    try {
      return await db.transaction(async (transaction) => {
        const [owner] = await transaction
          .insert(users)
          .values({
            name: input.username,
            email: input.email,
            emailVerified: input.emailVerified,
            role: input.role,
            accountStatus: input.accountStatus,
          })
          .returning({ id: users.id });
        if (!owner) throw new Error("LOCAL_OWNER_CREATE_FAILED");

        await transaction.insert(accounts).values({
          accountId: owner.id,
          providerId: "credential",
          userId: owner.id,
          password: input.passwordHash,
        });
        await transaction.insert(ownerRecoveryCodes).values(
          input.recoveryCodeHashes.map((codeHash) => ({ userId: owner.id, codeHash })),
        );
        await transaction.insert(localInstance).values({
          singletonKey: "owner",
          ownerUserId: owner.id,
          productVersion: input.productVersion,
        });
        return { userId: owner.id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("LOCAL_INSTANCE_INITIALIZED");
      throw error;
    }
  },
  async consumeRecoveryCode(input) {
    return db.transaction(async (transaction) => {
      const [consumed] = await transaction
        .update(ownerRecoveryCodes)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(ownerRecoveryCodes.codeHash, input.codeHash),
            isNull(ownerRecoveryCodes.consumedAt),
          ),
        )
        .returning({ userId: ownerRecoveryCodes.userId });
      if (!consumed) return null;

      const [updatedAccount] = await transaction
        .update(accounts)
        .set({ password: input.passwordHash, updatedAt: new Date() })
        .where(
          and(eq(accounts.userId, consumed.userId), eq(accounts.providerId, "credential")),
        )
        .returning({ id: accounts.id });
      if (!updatedAccount) throw new Error("LOCAL_OWNER_CREDENTIAL_MISSING");

      await transaction.delete(sessions).where(eq(sessions.userId, consumed.userId));
      return { userId: consumed.userId };
    });
  },
};

export async function getLocalInstanceState(
  repository: LocalOwnerRepository = databaseLocalOwnerRepository,
) {
  const instance = await repository.getInstance();
  return instance
    ? { initialized: true as const, ownerName: instance.username }
    : { initialized: false as const };
}

export async function initializeLocalOwner(
  input: { username: string; password: string },
  repository: LocalOwnerRepository = databaseLocalOwnerRepository,
  dependencies: LocalOwnerDependencies = defaultDependencies,
) {
  if (await repository.getInstance()) throw new Error("LOCAL_INSTANCE_INITIALIZED");

  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const recoveryCodes = dependencies.generateRecoveryCodes();
  if (recoveryCodes.length === 0 || new Set(recoveryCodes).size !== recoveryCodes.length) {
    throw new Error("RECOVERY_CODE_GENERATION_FAILED");
  }
  const passwordHash = await dependencies.hashPassword(password);

  await repository.createOwner({
    username,
    email: LOCAL_OWNER_EMAIL,
    emailVerified: true,
    role: "admin",
    accountStatus: "active",
    passwordHash,
    recoveryCodeHashes: recoveryCodes.map(dependencies.hashRecoveryCode),
    productVersion: dependencies.productVersion,
  });
  return { initialized: true as const, recoveryCodes };
}

export async function consumeRecoveryCode(
  input: { code: string; password: string },
  repository: LocalOwnerRepository = databaseLocalOwnerRepository,
  dependencies: LocalOwnerDependencies = defaultDependencies,
) {
  validatePassword(input.password);
  const codeHash = dependencies.hashRecoveryCode(normalizeRecoveryCode(input.code));
  const passwordHash = await dependencies.hashPassword(input.password);
  const consumed = await repository.consumeRecoveryCode({ codeHash, passwordHash });
  if (!consumed) throw new Error("RECOVERY_CODE_INVALID");
  return { reset: true as const };
}
