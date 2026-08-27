import { describe, expect, test, vi } from "vitest";

import {
  AI_DEAD_LETTER_QUEUE,
  AI_QUEUE_NAMES,
  AI_QUEUE_OPTIONS,
  KNOWLEDGE_DEAD_LETTER_QUEUE,
  KNOWLEDGE_INGEST_QUEUE,
  KNOWLEDGE_JOB_OPTIONS,
  PgBossAiJobQueue,
  PgBossKnowledgeJobQueue,
  ensureAiQueues,
} from "./queues";

describe("AI pg-boss queues", () => {
  test("uses the run ID as the job ID and the same transaction adapter", async () => {
    const send = vi.fn().mockResolvedValue("50000000-0000-4000-8000-000000000001");
    const boss = { send };
    const queue = new PgBossAiJobQueue(boss as never);
    const transaction = { execute: vi.fn() };
    const payload = { aiRunId: "50000000-0000-4000-8000-000000000001" };

    await queue.send("content_plan", payload, transaction, "owner-hmac");

    expect(send).toHaveBeenCalledTimes(1);
    const [name, sentPayload, options] = send.mock.calls[0]!;
    expect(name).toBe(AI_QUEUE_NAMES.content_plan);
    expect(sentPayload).toEqual(payload);
    expect(Object.keys(sentPayload)).toEqual(["aiRunId"]);
    expect(options).toMatchObject({
      id: payload.aiRunId,
      singletonKey: "owner-hmac",
      retryLimit: 0,
      expireInSeconds: 300,
      deadLetter: AI_DEAD_LETTER_QUEUE,
    });
    expect(options.db).toEqual(expect.objectContaining({ executeSql: expect.any(Function) }));
  });

  test("creates AI queues without automatic model retries", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    await ensureAiQueues({ createQueue } as never);

    expect(createQueue).toHaveBeenCalledWith(AI_DEAD_LETTER_QUEUE);
    for (const name of Object.values(AI_QUEUE_NAMES)) {
      expect(createQueue).toHaveBeenCalledWith(name, AI_QUEUE_OPTIONS);
    }
    expect(AI_QUEUE_OPTIONS).toMatchObject({ policy: "singleton" });
    expect(createQueue).toHaveBeenCalledWith(KNOWLEDGE_DEAD_LETTER_QUEUE);
    expect(createQueue).toHaveBeenCalledWith(KNOWLEDGE_INGEST_QUEUE, {
      policy: "singleton",
      ...KNOWLEDGE_JOB_OPTIONS,
    });
  });

  test("sends the knowledge job in the caller database transaction", async () => {
    const send = vi.fn().mockResolvedValue("60000000-0000-4000-8000-000000000001");
    const transaction = { execute: vi.fn() };
    const queue = new PgBossKnowledgeJobQueue({ send } as never);

    await queue.send(
      { ingestionJobId: "60000000-0000-4000-8000-000000000001" },
      transaction,
    );

    expect(send).toHaveBeenCalledWith(
      KNOWLEDGE_INGEST_QUEUE,
      { ingestionJobId: "60000000-0000-4000-8000-000000000001" },
      expect.objectContaining({
        id: "60000000-0000-4000-8000-000000000001",
        singletonKey: "60000000-0000-4000-8000-000000000001",
        retryLimit: 1,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
  });
});
