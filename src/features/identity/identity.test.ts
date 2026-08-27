import { describe, expect, test, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  assertOwnedBy,
  assertSessionUserActive,
  resolveCurrentActor,
  type ActorIdentityRepository,
  type CurrentActor,
} from "./current-actor";
import {
  ACTOR_OWNED_TABLE_NAMES,
  GUEST_LIST_TABLES,
  GUEST_SINGLETON_TABLES,
  mergeGuestIntoUser,
  mergeGuestOnSessionCreation,
  type GuestMergeRepository,
  type GuestMergeTransaction,
  type GuestSessionForMerge,
  type MergeUserIdentity,
  type SingletonDraft,
} from "./merge-guest";
import {
  GUEST_COOKIE_NAME,
  createGuestCookie,
  createGuestToken,
  hashGuestToken,
} from "@/lib/auth/guest-token";
import {
  GENERIC_ACCOUNT_MESSAGE,
  assertTrustedMutationOrigin,
  genericAccountResponse,
} from "@/lib/auth/security";
import {
  AUTH_RATE_LIMIT_OPTIONS,
  LOCAL_EMAIL_PASSWORD_OPTIONS,
  parseTrustedProxies,
} from "@/lib/auth/auth-policy";
import { ACTOR_OWNED_TABLES, guestSessions, users } from "@/server/db/schema";
import {
  mergeGuestForAuthenticatedRequest,
  startGuestTrial,
  type GuestTrialRepository,
} from "./guest-session";
import { AUTH_SUCCESS_TARGET, HOME_REDIRECT_TARGET } from "./navigation";

type CookieReader = { get(name: string): { value: string } | undefined };

function cookieReader(token?: string): CookieReader {
  return {
    get(name) {
      return name === GUEST_COOKIE_NAME && token ? { value: token } : undefined;
    },
  };
}

function createActorRepository(
  overrides: Partial<ActorIdentityRepository> = {},
): ActorIdentityRepository {
  return {
    getSessionUserId: vi.fn().mockResolvedValue(null),
    findUserIdentity: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function verifiedUser(overrides: Partial<MergeUserIdentity> = {}): MergeUserIdentity {
  return {
    id: "user-1",
    emailVerified: true,
    role: "user",
    accountStatus: "active",
    ...overrides,
  };
}

class FakeMergeTransaction implements GuestMergeTransaction {
  calls: string[] = [];
  guest: GuestSessionForMerge | null = {
    id: "guest-1",
    convertedToUserId: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  user: MergeUserIdentity | null = verifiedUser();
  singletons = new Map<string, { guest: SingletonDraft | null; user: SingletonDraft | null }>();
  movedTables: string[] = [];
  conflicts = new Map<string, SingletonDraft>();
  failOnTable: string | null = null;

  async deferAllConstraints() {
    this.calls.push("defer");
  }

  async lockGuestSession(guestSessionId: string) {
    this.calls.push(`lock:${guestSessionId}`);
    return this.guest;
  }

  async findUserIdentity(userId: string) {
    this.calls.push(`user:${userId}`);
    return this.user;
  }

  async findSingleton(table: string, owner: "guest" | "user") {
    this.calls.push(`read:${table}:${owner}`);
    return this.singletons.get(table)?.[owner] ?? null;
  }

  async moveSingletonToUser(table: string) {
    this.calls.push(`move-singleton:${table}`);
    this.movedTables.push(table);
  }

  async preserveSingletonConflict(table: string, guestDraft: SingletonDraft) {
    this.calls.push(`conflict:${table}`);
    this.conflicts.set(table, guestDraft);
  }

  async resolvePlatformAccountActiveConflict() {
    this.calls.push("resolve-platform-active");
  }

  async moveListTableToUser(table: string) {
    this.calls.push(`move-list:${table}`);
    if (this.failOnTable === table) throw new Error("INJECTED_FAILURE");
    this.movedTables.push(table);
  }

  async revokeGuest(guestSessionId: string, userId: string) {
    this.calls.push(`revoke:${guestSessionId}:${userId}`);
    if (this.guest) {
      this.guest = { ...this.guest, convertedToUserId: userId, revokedAt: new Date() };
    }
  }
}

class FakeMergeRepository implements GuestMergeRepository {
  constructor(readonly transactionState: FakeMergeTransaction) {}
  committedCalls: string[] = [];

  async transaction<T>(operation: (tx: GuestMergeTransaction) => Promise<T>) {
    const snapshot = structuredClone({
      guest: this.transactionState.guest,
      movedTables: this.transactionState.movedTables,
      conflicts: [...this.transactionState.conflicts.entries()],
    });
    try {
      const result = await operation(this.transactionState);
      this.committedCalls = [...this.transactionState.calls];
      return result;
    } catch (error) {
      this.transactionState.guest = snapshot.guest;
      this.transactionState.movedTables = snapshot.movedTables;
      this.transactionState.conflicts = new Map(snapshot.conflicts);
      this.committedCalls = [];
      throw error;
    }
  }
}

describe("ownership guards", () => {
  test("rejects access to another user's record", () => {
    const actor = { kind: "user", userId: "user-1", role: "user" } as const;
    expect(() => assertOwnedBy(actor, { userId: "user-2", guestSessionId: null })).toThrow(
      "FORBIDDEN",
    );
  });

  test("allows only the matching guest session", () => {
    const actor = { kind: "guest", guestSessionId: "guest-1" } as const;
    expect(() => assertOwnedBy(actor, { userId: null, guestSessionId: "guest-1" })).not.toThrow();
    expect(() => assertOwnedBy(actor, { userId: null, guestSessionId: "guest-2" })).toThrow(
      "FORBIDDEN",
    );
  });
});

describe("opaque guest identity", () => {
  test("generates at least 32 random bytes and stores only a stable SHA-256 hash", () => {
    const tokenA = createGuestToken();
    const tokenB = createGuestToken();

    expect(Buffer.from(tokenA, "base64url")).toHaveLength(32);
    expect(tokenA).not.toBe(tokenB);
    expect(hashGuestToken(tokenA)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashGuestToken(tokenA)).toBe(hashGuestToken(tokenA));
    expect(hashGuestToken(tokenA)).not.toContain(tokenA);
  });

  test("uses a 30-day HttpOnly same-site cookie and enables Secure in production", () => {
    const cookie = createGuestCookie("opaque-token", true);

    expect(cookie).toMatchObject({
      name: GUEST_COOKIE_NAME,
      value: "opaque-token",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  test("persists only the guest token hash", async () => {
    const create = vi.fn().mockResolvedValue({ id: "guest-1" });
    const repository: GuestTrialRepository = {
      findActiveByTokenHash: vi.fn().mockResolvedValue(null),
      create,
    };

    const trial = await startGuestTrial(repository, new Date("2026-08-08T00:00:00Z"), true);

    expect(create).toHaveBeenCalledWith({
      tokenHash: hashGuestToken(trial.cookie.value),
      expiresAt: new Date("2026-09-07T00:00:00Z"),
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain(trial.cookie.value);
    expect(trial.guestSessionId).toBe("guest-1");
  });

  test("merge entry reads only the server session and guest cookie", async () => {
    const token = createGuestToken();
    const merge = vi.fn().mockResolvedValue(true);
    const getSessionUserId = vi.fn().mockResolvedValue("user-1");

    await expect(
      mergeGuestForAuthenticatedRequest(new Headers(), cookieReader(token), {
        getSessionUserId,
        mergeGuestTokenIntoUser: merge,
      }),
    ).resolves.toBe(true);
    expect(getSessionUserId).toHaveBeenCalledWith(expect.any(Headers));
    expect(merge).toHaveBeenCalledWith(token, "user-1");
  });

  test("session creation merges and clears the guest cookie before redirect", async () => {
    const token = createGuestToken();
    const merge = vi.fn().mockResolvedValue(true);
    const setCookie = vi.fn();

    await mergeGuestOnSessionCreation(
      `${GUEST_COOKIE_NAME}=${token}`,
      "user-1",
      merge,
      setCookie,
      true,
    );

    expect(merge).toHaveBeenCalledWith(token, "user-1");
    expect(setCookie).toHaveBeenCalledWith(
      GUEST_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0, httpOnly: true, sameSite: "lax", secure: true }),
    );
  });
});

describe("current actor resolution", () => {
  test("reads verified role and account status from the database", async () => {
    const repository = createActorRepository({
      getSessionUserId: vi.fn().mockResolvedValue("user-1"),
      findUserIdentity: vi.fn().mockResolvedValue(verifiedUser({ role: "admin" })),
    });

    await expect(
      resolveCurrentActor(new Headers(), cookieReader(), repository),
    ).resolves.toEqual({ kind: "user", userId: "user-1", role: "admin" });
  });

  test.each([
    verifiedUser({ emailVerified: false }),
    verifiedUser({ accountStatus: "suspended" }),
    verifiedUser({ accountStatus: "deleted" }),
  ])("rejects unverified or inactive database identity", async (identity) => {
    const repository = createActorRepository({
      getSessionUserId: vi.fn().mockResolvedValue(identity.id),
      findUserIdentity: vi.fn().mockResolvedValue(identity),
    });

    await expect(resolveCurrentActor(new Headers(), cookieReader(), repository)).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  test("rejects a cookie-only legacy guest identity", async () => {
    const token = createGuestToken();
    const repository = createActorRepository();

    await expect(
      resolveCurrentActor(new Headers(), cookieReader(token), repository),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  test("blocks inactive users before Better Auth creates a session", async () => {
    const repository = createActorRepository({
      findUserIdentity: vi.fn().mockResolvedValue(verifiedUser({ accountStatus: "suspended" })),
    });

    await expect(assertSessionUserActive("user-1", repository)).rejects.toThrow("ACCOUNT_INACTIVE");
  });
});

describe("guest merge transaction", () => {
  test("retains converted guest audit when a user is deleted", () => {
    const config = getTableConfig(guestSessions);
    const convertedUserForeignKey = config.foreignKeys.find((foreignKey) =>
      foreignKey.reference().foreignTable === users,
    );

    expect(convertedUserForeignKey?.onDelete).toBe("restrict");
  });

  test("covers every actor-owned table exactly once", () => {
    expect(new Set(ACTOR_OWNED_TABLE_NAMES)).toEqual(new Set(Object.keys(ACTOR_OWNED_TABLES)));
    expect(new Set([...GUEST_SINGLETON_TABLES, ...GUEST_LIST_TABLES])).toEqual(
      new Set(ACTOR_OWNED_TABLE_NAMES),
    );
  });

  test("locks the guest session and migrates all list data in one transaction", async () => {
    const tx = new FakeMergeTransaction();
    const repository = new FakeMergeRepository(tx);

    await mergeGuestIntoUser("guest-1", "user-1", repository);

    expect(tx.calls.slice(0, 3)).toEqual(["defer", "lock:guest-1", "user:user-1"]);
    expect(tx.movedTables).toEqual(expect.arrayContaining([...GUEST_LIST_TABLES]));
    expect(tx.guest).toMatchObject({ convertedToUserId: "user-1" });
    expect(repository.committedCalls.at(-1)).toBe("revoke:guest-1:user-1");
    expect(tx.calls.indexOf("resolve-platform-active")).toBeLessThan(tx.calls.indexOf("move-list:platformAccounts"));
  });

  test("refuses to merge into an unverified user", async () => {
    const tx = new FakeMergeTransaction();
    tx.user = verifiedUser({ emailVerified: false });

    await expect(
      mergeGuestIntoUser("guest-1", "user-1", new FakeMergeRepository(tx)),
    ).rejects.toThrow("EMAIL_NOT_VERIFIED");
    expect(tx.movedTables).toHaveLength(0);
  });

  test("refuses to merge an expired guest session", async () => {
    const tx = new FakeMergeTransaction();
    tx.guest = { ...tx.guest!, expiresAt: new Date(Date.now() - 1) };

    await expect(
      mergeGuestIntoUser("guest-1", "user-1", new FakeMergeRepository(tx)),
    ).rejects.toThrow("GUEST_SESSION_EXPIRED");
    expect(tx.calls).toEqual(["defer", "lock:guest-1"]);
  });

  test("accepts the PostgreSQL timestamp string returned by a raw locked guest row", async () => {
    const tx = new FakeMergeTransaction();
    tx.guest = {
      ...tx.guest!,
      expiresAt: new Date(Date.now() + 60_000).toISOString() as unknown as Date,
    };

    await expect(
      mergeGuestIntoUser("guest-1", "user-1", new FakeMergeRepository(tx)),
    ).resolves.toBeUndefined();
    expect(tx.guest).toMatchObject({ convertedToUserId: "user-1" });
  });

  test("preserves the user singleton and records a guest draft on conflict", async () => {
    const tx = new FakeMergeTransaction();
    const guestDraft = { id: "guest-profile", currentPositioning: "美食创作者" };
    tx.singletons.set("creatorProfiles", {
      guest: guestDraft,
      user: { id: "user-profile", currentPositioning: "AI 产品" },
    });

    await mergeGuestIntoUser("guest-1", "user-1", new FakeMergeRepository(tx));

    expect(tx.conflicts.get("creatorProfiles")).toEqual(guestDraft);
    expect(tx.calls).not.toContain("move-singleton:creatorProfiles");
  });

  test("rolls back every migration when one table fails", async () => {
    const tx = new FakeMergeTransaction();
    tx.failOnTable = GUEST_LIST_TABLES[1];
    const repository = new FakeMergeRepository(tx);

    await expect(mergeGuestIntoUser("guest-1", "user-1", repository)).rejects.toThrow(
      "INJECTED_FAILURE",
    );
    expect(tx.movedTables).toEqual([]);
    expect(tx.guest).toMatchObject({ convertedToUserId: null, revokedAt: null });
    expect(repository.committedCalls).toEqual([]);
  });

  test("is idempotent after the same guest has already converted", async () => {
    const tx = new FakeMergeTransaction();
    tx.guest = {
      id: "guest-1",
      convertedToUserId: "user-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    await mergeGuestIntoUser("guest-1", "user-1", new FakeMergeRepository(tx));

    expect(tx.calls).toEqual(["defer", "lock:guest-1"]);
    expect(tx.movedTables).toEqual([]);
  });
});

describe("account recovery security", () => {
  test("applies dedicated auth throttles and explicit trusted proxies", () => {
    expect(AUTH_RATE_LIMIT_OPTIONS.customRules["/sign-in/email"]).toEqual({
      window: 60,
      max: 10,
    });
    expect(AUTH_RATE_LIMIT_OPTIONS.customRules["/request-password-reset"]).toEqual({
      window: 60 * 15,
      max: 5,
    });
    expect(parseTrustedProxies("10.0.0.1, 192.0.2.0/24")).toEqual([
      "10.0.0.1",
      "192.0.2.0/24",
    ]);
  });

  test("returns the same message regardless of account existence", () => {
    expect(genericAccountResponse()).toEqual({ ok: true, message: GENERIC_ACCOUNT_MESSAGE });
  });

  test("rejects a custom mutation without the configured origin", () => {
    expect(() => assertTrustedMutationOrigin(null, "https://creator.example")).toThrow(
      "INVALID_ORIGIN",
    );
    expect(() =>
      assertTrustedMutationOrigin("https://evil.example", "https://creator.example"),
    ).toThrow("INVALID_ORIGIN");
    expect(() =>
      assertTrustedMutationOrigin("https://creator.example", "https://creator.example"),
    ).not.toThrow();
  });
});

test("CurrentActor does not carry client-provided role or guest ids", () => {
  const actor: CurrentActor = { kind: "user", userId: "user-1", role: "user" };
  expect(actor).toEqual({ kind: "user", userId: "user-1", role: "user" });
});

test("unauthenticated product routes return to local login", () => {
  expect(HOME_REDIRECT_TARGET).toBe("/login");
  expect(AUTH_SUCCESS_TARGET).toBe("/workspace");
});

test("disables public sign-up and email delivery flows", () => {
  expect(LOCAL_EMAIL_PASSWORD_OPTIONS).toEqual({
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  });
});
