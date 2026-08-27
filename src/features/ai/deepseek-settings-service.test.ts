import { describe, expect, test, vi } from "vitest";

import {
  getDeepSeekStatus,
  resolveDeepSeekCredential,
  revokeDeepSeekKey,
  saveDeepSeekKey,
  testAndSaveDeepSeekKey,
  type DeepSeekCredentialRecord,
  type DeepSeekSettingsRepository,
} from "./deepseek-settings-service";

class MemoryRepository implements DeepSeekSettingsRepository {
  record: DeepSeekCredentialRecord | null = null;
  usage = { inputTokens: 321, outputTokens: 123 };
  recentUsage = [
    {
      runId: "50000000-0000-4000-8000-000000000001",
      taskType: "content_plan" as const,
      inputTokens: 210,
      outputTokens: 88,
      createdAt: new Date("2026-08-24T12:30:00Z"),
    },
  ];

  async getCredential(userId: string) {
    return this.record?.userId === userId ? this.record : null;
  }

  async upsertCredential(record: DeepSeekCredentialRecord) {
    this.record = record;
  }

  async revokeCredential(userId: string, revokedAt: Date) {
    if (!this.record || this.record.userId !== userId) return false;
    this.record = {
      ...this.record,
      ciphertext: "",
      iv: "",
      authTag: "",
      revokedAt,
      updatedAt: revokedAt,
    };
    return true;
  }

  async getMonthlyUsage() {
    return this.usage;
  }

  async getRecentUsage() {
    return this.recentUsage;
  }
}

const masterKey = Buffer.alloc(32, 7);
const dependencies = { loadMasterKey: async () => masterKey };
const userId = "10000000-0000-4000-8000-000000000001";
const apiKey = ["sk", "1234567890abcdefghijklmnopqrstuv"].join("-");

describe("DeepSeek BYOK settings", () => {
  test("stores an encrypted envelope and exposes only status plus last four", async () => {
    const repository = new MemoryRepository();
    const testedAt = new Date("2026-08-24T12:00:00Z");

    await saveDeepSeekKey(
      userId,
      apiKey,
      { consent: true, testedAt },
      repository,
      dependencies,
    );

    expect(repository.record).toMatchObject({
      userId,
      envelopeVersion: 1,
      lastFour: "stuv",
      consentedAt: expect.any(Date),
      testedAt,
      revokedAt: null,
    });
    expect(JSON.stringify(repository.record)).not.toContain(apiKey);
    await expect(getDeepSeekStatus(userId, repository)).resolves.toEqual({
      configured: true,
      lastFour: "stuv",
      testedAt,
      monthlyUsage: { inputTokens: 321, outputTokens: 123 },
      recentUsage: repository.recentUsage,
    });
    await expect(resolveDeepSeekCredential(userId, repository, dependencies)).resolves.toBe(apiKey);
  });

  test("requires explicit privacy consent before saving", async () => {
    const repository = new MemoryRepository();
    await expect(
      saveDeepSeekKey(userId, apiKey, { consent: false }, repository, dependencies),
    ).rejects.toThrow("DEEPSEEK_CONSENT_REQUIRED");
    expect(repository.record).toBeNull();
  });

  test("tests a replacement key before persisting it", async () => {
    const repository = new MemoryRepository();
    const verifyKey = vi.fn(async () => undefined);

    await testAndSaveDeepSeekKey(
      userId,
      apiKey,
      true,
      repository,
      { ...dependencies, verifyKey },
    );

    expect(verifyKey).toHaveBeenCalledWith(apiKey);
    expect(repository.record?.testedAt).toBeInstanceOf(Date);
  });

  test("revokes and destroys the stored envelope", async () => {
    const repository = new MemoryRepository();
    await saveDeepSeekKey(userId, apiKey, { consent: true }, repository, dependencies);

    await expect(revokeDeepSeekKey(userId, repository)).resolves.toEqual({ revoked: true });
    expect(repository.record).toMatchObject({ ciphertext: "", iv: "", authTag: "" });
    await expect(resolveDeepSeekCredential(userId, repository, dependencies)).rejects.toThrow(
      "DEEPSEEK_NOT_CONFIGURED",
    );
  });

  test("returns an empty status for an unconfigured Owner", async () => {
    await expect(getDeepSeekStatus(userId, new MemoryRepository())).resolves.toEqual({
      configured: false,
      monthlyUsage: { inputTokens: 321, outputTokens: 123 },
      recentUsage: expect.any(Array),
    });
  });
});
