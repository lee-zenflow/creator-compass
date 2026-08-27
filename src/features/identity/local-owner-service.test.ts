import { describe, expect, test, vi } from "vitest";

import {
  LOCAL_OWNER_EMAIL,
  consumeRecoveryCode,
  getLocalInstanceState,
  initializeLocalOwner,
  type LocalOwnerRepository,
} from "./local-owner-service";

function createRepository(): LocalOwnerRepository & {
  createdInput?: Record<string, unknown>;
  passwordHash?: string;
} {
  const state: {
    owner: { userId: string; username: string } | null;
    availableCodeHashes: Set<string>;
  } = { owner: null, availableCodeHashes: new Set() };

  return {
    async getInstance() {
      return state.owner;
    },
    async createOwner(input) {
      if (state.owner) throw new Error("LOCAL_INSTANCE_INITIALIZED");
      this.createdInput = input;
      state.owner = { userId: "owner-1", username: input.username };
      state.availableCodeHashes = new Set(input.recoveryCodeHashes);
      return { userId: "owner-1" };
    },
    async consumeRecoveryCode(input) {
      if (!state.availableCodeHashes.delete(input.codeHash)) return null;
      this.passwordHash = input.passwordHash;
      return { userId: "owner-1" };
    },
  };
}

const dependencies = {
  hashPassword: vi.fn(async (password: string) => `password-hash:${password}`),
  generateRecoveryCodes: vi.fn(() => ["CC-AAAA-BBBB-1111", "CC-CCCC-DDDD-2222"]),
  hashRecoveryCode: vi.fn((code: string) => `code-hash:${code}`),
  productVersion: "test-version",
};

describe("local Owner initialization", () => {
  test("creates exactly one verified admin with the internal synthetic email", async () => {
    const repository = createRepository();

    await expect(
      initializeLocalOwner(
        { username: " 本地创作者 ", password: "correct-horse-battery" },
        repository,
        dependencies,
      ),
    ).resolves.toEqual({
      initialized: true,
      recoveryCodes: ["CC-AAAA-BBBB-1111", "CC-CCCC-DDDD-2222"],
    });

    expect(repository.createdInput).toMatchObject({
      username: "本地创作者",
      email: LOCAL_OWNER_EMAIL,
      emailVerified: true,
      role: "admin",
      accountStatus: "active",
      passwordHash: "password-hash:correct-horse-battery",
      recoveryCodeHashes: [
        "code-hash:CC-AAAA-BBBB-1111",
        "code-hash:CC-CCCC-DDDD-2222",
      ],
      productVersion: "test-version",
    });
    expect(JSON.stringify(repository.createdInput)).not.toContain('"password":"');
  });

  test("closes initialization after the first Owner", async () => {
    const repository = createRepository();
    await initializeLocalOwner(
      { username: "本地创作者", password: "correct-horse-battery" },
      repository,
      dependencies,
    );

    await expect(
      initializeLocalOwner(
        { username: "second", password: "another-password" },
        repository,
        dependencies,
      ),
    ).rejects.toThrow("LOCAL_INSTANCE_INITIALIZED");
    await expect(getLocalInstanceState(repository)).resolves.toEqual({
      initialized: true,
      ownerName: "本地创作者",
    });
  });

  test("uses a recovery code once and replaces the password hash", async () => {
    const repository = createRepository();
    const initialized = await initializeLocalOwner(
      { username: "本地创作者", password: "correct-horse-battery" },
      repository,
      dependencies,
    );
    const code = initialized.recoveryCodes[0]!;

    await expect(
      consumeRecoveryCode(
        { code, password: "replacement-password" },
        repository,
        dependencies,
      ),
    ).resolves.toEqual({ reset: true });
    expect(repository.passwordHash).toBe("password-hash:replacement-password");
    await expect(
      consumeRecoveryCode(
        { code, password: "again-password" },
        repository,
        dependencies,
      ),
    ).rejects.toThrow("RECOVERY_CODE_INVALID");
  });

  test("reports an uninitialized instance without creating data", async () => {
    await expect(getLocalInstanceState(createRepository())).resolves.toEqual({
      initialized: false,
    });
  });
});
