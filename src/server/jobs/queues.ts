import { sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import type { DrizzleTransactionLike } from "pg-boss";

import type { AiTaskType } from "@/server/ai/ai-schemas";
import { getBoss } from "./boss";

export const AI_DEAD_LETTER_QUEUE = "ai-dead-letter";
export const KNOWLEDGE_INGEST_QUEUE = "knowledge-ingest";
export const KNOWLEDGE_DEAD_LETTER_QUEUE = "knowledge-ingest-dead-letter";
export const AI_QUEUE_NAMES: Record<AiTaskType, string> = {
  profile_extract: "ai-profile-extract",
  positioning_report: "ai-positioning-report",
  content_plan: "ai-content-plan",
  review_report: "ai-review-report",
};

export const AI_JOB_OPTIONS = {
  retryLimit: 0,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 300,
  deadLetter: AI_DEAD_LETTER_QUEUE,
} as const;
export const AI_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  ...AI_JOB_OPTIONS,
};

export const KNOWLEDGE_JOB_OPTIONS = {
  retryLimit: 1,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 300,
  deadLetter: KNOWLEDGE_DEAD_LETTER_QUEUE,
} as const;

export const KNOWLEDGE_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  ...KNOWLEDGE_JOB_OPTIONS,
};

export type AiJobPayload = { aiRunId: string };
export type AiQueueTransaction = DrizzleTransactionLike;
export type KnowledgeJobPayload = { ingestionJobId: string };

export interface KnowledgeJobQueue {
  send(payload: KnowledgeJobPayload, transaction: AiQueueTransaction): Promise<void>;
}

export interface AiJobQueue {
  ready?(): Promise<void>;
  send(
    taskType: AiTaskType,
    payload: AiJobPayload,
    transaction?: AiQueueTransaction,
    ownerSingletonKey?: string,
  ): Promise<void>;
}

export class PgBossAiJobQueue implements AiJobQueue {
  constructor(private readonly boss: PgBoss = getBoss()) {}

  ready() {
    return ensureAiQueueInfrastructure(this.boss);
  }

  async send(
    taskType: AiTaskType,
    payload: AiJobPayload,
    transaction?: AiQueueTransaction,
    ownerSingletonKey?: string,
  ) {
    const id = await this.boss.send(AI_QUEUE_NAMES[taskType], payload, {
      id: payload.aiRunId,
      singletonKey: ownerSingletonKey ?? payload.aiRunId,
      ...AI_JOB_OPTIONS,
      ...(transaction ? { db: fromDrizzle(transaction, sql) } : {}),
    });
    if (!id) throw new Error("AI_QUEUE_INSERT_FAILED");
  }
}

export const databaseAiJobQueue = new PgBossAiJobQueue();

export class PgBossKnowledgeJobQueue implements KnowledgeJobQueue {
  constructor(private readonly boss: PgBoss = getBoss()) {}

  async send(payload: KnowledgeJobPayload, transaction: AiQueueTransaction) {
    const id = await this.boss.send(KNOWLEDGE_INGEST_QUEUE, payload, {
      id: payload.ingestionJobId,
      singletonKey: payload.ingestionJobId,
      ...KNOWLEDGE_JOB_OPTIONS,
      db: fromDrizzle(transaction, sql),
    });
    if (!id) throw new Error("KNOWLEDGE_QUEUE_INSERT_FAILED");
  }
}

export const databaseKnowledgeJobQueue = new PgBossKnowledgeJobQueue();

export async function ensureAiQueues(boss: PgBoss = getBoss()) {
  await boss.createQueue(AI_DEAD_LETTER_QUEUE);
  for (const queueName of Object.values(AI_QUEUE_NAMES)) {
    await boss.createQueue(queueName, AI_QUEUE_OPTIONS);
  }
  await boss.createQueue(KNOWLEDGE_DEAD_LETTER_QUEUE);
  await boss.createQueue(KNOWLEDGE_INGEST_QUEUE, KNOWLEDGE_QUEUE_OPTIONS);
}

const infrastructurePromises = new WeakMap<object, Promise<void>>();

export function ensureAiQueueInfrastructure(boss: PgBoss = getBoss()) {
  const current = infrastructurePromises.get(boss);
  if (current) return current;
  const started = (async () => {
    await boss.start();
    await ensureAiQueues(boss);
  })();
  infrastructurePromises.set(boss, started);
  started.catch(() => infrastructurePromises.delete(boss));
  return started;
}
