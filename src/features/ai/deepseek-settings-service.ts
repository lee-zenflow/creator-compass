import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/server/db/client";
import { aiRuns, aiUsageRecords, deepseekCredentials } from "@/server/db/schema";
import type { AiTaskType } from "@/server/ai/ai-schemas";
import { decryptSecret, encryptSecret } from "@/server/security/key-envelope";
import { loadOrCreateMasterKey } from "@/server/security/master-key";
import { DeepSeekClient } from "@/server/ai/deepseek-client";

export type DeepSeekCredentialRecord = {
  userId: string;
  envelopeVersion: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  lastFour: string;
  consentedAt: Date;
  testedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeepSeekRunUsage = {
  runId: string;
  taskType: AiTaskType;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
};

export interface DeepSeekSettingsRepository {
  getCredential(userId: string): Promise<DeepSeekCredentialRecord | null>;
  upsertCredential(record: DeepSeekCredentialRecord): Promise<void>;
  revokeCredential(userId: string, revokedAt: Date): Promise<boolean>;
  getMonthlyUsage(userId: string): Promise<{ inputTokens: number; outputTokens: number }>;
  getRecentUsage(userId: string): Promise<DeepSeekRunUsage[]>;
}

type DeepSeekSettingsDependencies = {
  loadMasterKey(): Promise<Buffer>;
};

type DeepSeekTestDependencies = DeepSeekSettingsDependencies & {
  verifyKey(apiKey: string): Promise<void>;
};

function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const databaseDeepSeekSettingsRepository: DeepSeekSettingsRepository = {
  async getCredential(userId) {
    const [record] = await db
      .select()
      .from(deepseekCredentials)
      .where(eq(deepseekCredentials.userId, userId))
      .limit(1);
    return record ?? null;
  },
  async upsertCredential(record) {
    await db
      .insert(deepseekCredentials)
      .values(record)
      .onConflictDoUpdate({
        target: deepseekCredentials.userId,
        set: {
          envelopeVersion: record.envelopeVersion,
          ciphertext: record.ciphertext,
          iv: record.iv,
          authTag: record.authTag,
          lastFour: record.lastFour,
          consentedAt: record.consentedAt,
          testedAt: record.testedAt,
          revokedAt: null,
          updatedAt: record.updatedAt,
        },
      });
  },
  async revokeCredential(userId, revokedAt) {
    const rows = await db
      .update(deepseekCredentials)
      .set({ ciphertext: "", iv: "", authTag: "", revokedAt, updatedAt: revokedAt })
      .where(and(eq(deepseekCredentials.userId, userId), isNull(deepseekCredentials.revokedAt)))
      .returning({ userId: deepseekCredentials.userId });
    return rows.length === 1;
  },
  async getMonthlyUsage(userId) {
    const [usage] = await db
      .select({
        inputTokens: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageRecords.outputTokens}), 0)::int`,
      })
      .from(aiUsageRecords)
      .where(
        and(
          eq(aiUsageRecords.userId, userId),
          gte(aiUsageRecords.createdAt, monthStartUtc()),
        ),
      );
    return usage ?? { inputTokens: 0, outputTokens: 0 };
  },
  async getRecentUsage(userId) {
    return db
      .select({
        runId: aiUsageRecords.aiRunId,
        taskType: aiRuns.taskType,
        inputTokens: aiUsageRecords.inputTokens,
        outputTokens: aiUsageRecords.outputTokens,
        createdAt: aiUsageRecords.createdAt,
      })
      .from(aiUsageRecords)
      .innerJoin(aiRuns, eq(aiRuns.id, aiUsageRecords.aiRunId))
      .where(eq(aiUsageRecords.userId, userId))
      .orderBy(desc(aiUsageRecords.createdAt))
      .limit(5);
  },
};

const defaultDependencies: DeepSeekTestDependencies = {
  loadMasterKey: () =>
    loadOrCreateMasterKey(
      process.env.CREATOR_COMPASS_MASTER_KEY_PATH ?? "./data/secrets/master.key",
    ),
  async verifyKey(apiKey) {
    await new DeepSeekClient({ apiKey }).generateJson({
      schema: z.object({ ok: z.literal(true) }).strict(),
      system: "This is a credential connection test. Return the required JSON only.",
      user: "Confirm the connection test with ok=true.",
    });
  },
};

function validateApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (!/^sk-[A-Za-z0-9_-]{17,125}$/.test(normalized)) {
    throw new Error("DEEPSEEK_KEY_INVALID");
  }
  return normalized;
}

export async function getDeepSeekStatus(
  userId: string,
  repository: DeepSeekSettingsRepository = databaseDeepSeekSettingsRepository,
) {
  const [credential, monthlyUsage, recentUsage] = await Promise.all([
    repository.getCredential(userId),
    repository.getMonthlyUsage(userId),
    repository.getRecentUsage(userId),
  ]);
  if (!credential || credential.revokedAt) {
    return { configured: false as const, monthlyUsage, recentUsage };
  }
  return {
    configured: true as const,
    lastFour: credential.lastFour,
    testedAt: credential.testedAt,
    monthlyUsage,
    recentUsage,
  };
}

export async function saveDeepSeekKey(
  userId: string,
  rawApiKey: string,
  options: { consent: boolean; testedAt?: Date },
  repository: DeepSeekSettingsRepository = databaseDeepSeekSettingsRepository,
  dependencies: DeepSeekSettingsDependencies = defaultDependencies,
) {
  if (!options.consent) throw new Error("DEEPSEEK_CONSENT_REQUIRED");
  const apiKey = validateApiKey(rawApiKey);
  const masterKey = await dependencies.loadMasterKey();
  const envelope = encryptSecret(apiKey, masterKey);
  const now = new Date();
  await repository.upsertCredential({
    userId,
    envelopeVersion: envelope.version,
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.authTag,
    lastFour: apiKey.slice(-4),
    consentedAt: now,
    testedAt: options.testedAt ?? null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return { configured: true as const, lastFour: apiKey.slice(-4) };
}

export async function resolveDeepSeekCredential(
  userId: string,
  repository: DeepSeekSettingsRepository = databaseDeepSeekSettingsRepository,
  dependencies: DeepSeekSettingsDependencies = defaultDependencies,
) {
  const credential = await repository.getCredential(userId);
  if (!credential || credential.revokedAt || !credential.ciphertext) {
    throw new Error("DEEPSEEK_NOT_CONFIGURED");
  }
  const masterKey = await dependencies.loadMasterKey();
  return decryptSecret(
    {
      version: credential.envelopeVersion,
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.authTag,
    },
    masterKey,
  );
}

export async function testAndSaveDeepSeekKey(
  userId: string,
  rawApiKey: string,
  consent: boolean,
  repository: DeepSeekSettingsRepository = databaseDeepSeekSettingsRepository,
  dependencies: DeepSeekTestDependencies = defaultDependencies,
) {
  if (!consent) throw new Error("DEEPSEEK_CONSENT_REQUIRED");
  const apiKey = validateApiKey(rawApiKey);
  await dependencies.verifyKey(apiKey);
  return saveDeepSeekKey(
    userId,
    apiKey,
    { consent: true, testedAt: new Date() },
    repository,
    dependencies,
  );
}

export async function revokeDeepSeekKey(
  userId: string,
  repository: DeepSeekSettingsRepository = databaseDeepSeekSettingsRepository,
) {
  const revoked = await repository.revokeCredential(userId, new Date());
  return { revoked };
}
