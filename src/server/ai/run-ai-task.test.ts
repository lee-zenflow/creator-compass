import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  enqueueAiRun,
  getAiRun,
  type AiRunRecord,
  type AiRunRepository,
  type AiSubject,
  type EnqueueAiRunDependencies,
} from "./run-ai-task";
import type { AiJobQueue } from "@/server/jobs/queues";

const owner: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "admin",
};
const other: CurrentActor = {
  kind: "user",
  userId: "20000000-0000-4000-8000-000000000002",
  role: "user",
};
const entityId = "30000000-0000-4000-8000-000000000003";

function actorKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

class MemoryAiRunRepository implements AiRunRepository {
  runs: AiRunRecord[] = [];
  quotaUsed = new Map<string, number>();
  transactions = 0;
  inserts = 0;
  private sequence = 0;

  constructor(
    private readonly subjects: Array<{ actor: CurrentActor; subject: AiSubject }> = [
      {
        actor: owner,
        subject: {
          entityId,
          inputKind: "creation_request",
          fieldCount: 3,
          characterCount: 100,
          hmacPayload: { goal: "测试创作方向", platform: "douyin" },
        },
      },
    ],
  ) {}

  async transaction<T>(work: (repository: AiRunRepository) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const runs = structuredClone(this.runs);
    const quota = new Map(this.quotaUsed);
    const inserts = this.inserts;
    try {
      return await work(this);
    } catch (error) {
      this.runs = runs;
      this.quotaUsed = quota;
      this.inserts = inserts;
      throw error;
    }
  }

  async lockIdempotency() {}

  async findOwnedSubject(actor: CurrentActor, _taskType: AiRunRecord["taskType"], requestedId: string) {
    return this.subjects.find(
      (entry) => actorKey(entry.actor) === actorKey(actor) && entry.subject.entityId === requestedId,
    )?.subject ?? null;
  }

  async findActivePrompt(taskType: AiRunRecord["taskType"]) {
    return {
      id: `40000000-0000-4000-8000-${taskType === "content_plan" ? "000000000004" : "000000000005"}`,
      template: "Trusted prompt {{UNTRUSTED_DATA}}",
      version: 1,
    };
  }

  async findByIdempotency(actor: CurrentActor, taskType: AiRunRecord["taskType"], idempotencyKey: string) {
    return this.runs.find(
      (run) => actorKey(run.owner) === actorKey(actor) && run.taskType === taskType && run.idempotencyKey === idempotencyKey,
    ) ?? null;
  }

  async consumeGuestQuota(actor: CurrentActor) {
    if (actor.kind !== "guest") return;
    const key = actorKey(actor);
    const used = this.quotaUsed.get(key) ?? 0;
    if (used >= 2) throw new Error("AI_QUOTA_EXCEEDED");
    this.quotaUsed.set(key, used + 1);
  }

  async insert(actor: CurrentActor, input: Omit<AiRunRecord, "id" | "owner" | "status" | "createdAt" | "updatedAt">) {
    this.inserts += 1;
    const now = new Date("2026-08-08T12:00:00Z");
    const run: AiRunRecord = {
      ...input,
      id: `50000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      owner: actor,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    };
    this.runs.push(run);
    return run;
  }

  async get(actor: CurrentActor, aiRunId: string) {
    return this.runs.find(
      (run) => run.id === aiRunId && actorKey(run.owner) === actorKey(actor),
    ) ?? null;
  }
}

class MemoryAiJobQueue implements AiJobQueue {
  sends: Array<{ taskType: AiRunRecord["taskType"]; payload: { aiRunId: string } }> = [];
  fail = false;
  async send(taskType: AiRunRecord["taskType"], payload: { aiRunId: string }) {
    if (this.fail) throw new Error("QUEUE_UNAVAILABLE");
    this.sends.push({ taskType, payload });
  }
}

function dependencies(repository = new MemoryAiRunRepository(), queue = new MemoryAiJobQueue()) {
  return {
    repository,
    queue,
    config: { hmacKey: "log-hmac-secret" },
    hasCredential: vi.fn(async () => true),
  } satisfies EnqueueAiRunDependencies;
}

describe("enqueueAiRun", () => {
  test("applies the endpoint limiter before opening a transaction", async () => {
    const base = dependencies();
    const deps = { ...base, rateLimit: vi.fn(() => { throw new Error("RATE_LIMITED"); }) };
    await expect(enqueueAiRun(owner, { taskType: "content_plan", entityId, idempotencyKey: "limited" }, deps)).rejects.toThrow("RATE_LIMITED");
    expect(base.repository.transactions).toBe(0);
  });

  test("returns NOT_CONFIGURED before transaction, quota, run, or queue writes", async () => {
    const deps = dependencies();
    deps.hasCredential.mockResolvedValue(false);

    await expect(
      enqueueAiRun(owner, { taskType: "content_plan", entityId, idempotencyKey: "create-1" }, deps),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    expect(deps.repository.transactions).toBe(0);
    expect(deps.repository.inserts).toBe(0);
    expect(deps.repository.quotaUsed.size).toBe(0);
    expect(deps.queue.sends).toEqual([]);
  });

  test("validates subject ownership before consuming quota", async () => {
    const deps = dependencies();
    await expect(
      enqueueAiRun(other, { taskType: "content_plan", entityId, idempotencyKey: "create-2" }, deps),
    ).rejects.toThrow("NOT_FOUND");
    expect(deps.repository.inserts).toBe(0);
    expect(deps.repository.quotaUsed.size).toBe(0);
  });

  test("creates one run and sends only aiRunId without the BYOK secret", async () => {
    const deps = dependencies();
    const input = { taskType: "content_plan" as const, entityId, idempotencyKey: "create-3" };

    const first = await enqueueAiRun(owner, input, deps);
    const retry = await enqueueAiRun(owner, input, deps);

    expect(retry.aiRunId).toBe(first.aiRunId);
    expect(deps.repository.inserts).toBe(1);
    expect(deps.queue.sends).toEqual([
      { taskType: "content_plan", payload: { aiRunId: first.aiRunId } },
    ]);
    expect(JSON.stringify(deps.queue.sends)).not.toContain("sk-");
    expect(deps.repository.runs[0]?.model).toBe("deepseek-v4-flash");
  });

  test("rejects an idempotency key reused for a different entity or input hash", async () => {
    const deps = dependencies();
    await enqueueAiRun(
      owner,
      { taskType: "content_plan", entityId, idempotencyKey: "create-conflict" },
      deps,
    );
    const subject = await deps.repository.findOwnedSubject(owner, "content_plan", entityId);
    subject!.hmacPayload = { goal: "内容已变化" };

    await expect(
      enqueueAiRun(
        owner,
        { taskType: "content_plan", entityId, idempotencyKey: "create-conflict" },
        deps,
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(deps.repository.inserts).toBe(1);
  });

  test("rolls back run and quota when atomic queue insertion fails", async () => {
    const queue = new MemoryAiJobQueue();
    queue.fail = true;
    const deps = dependencies(new MemoryAiRunRepository(), queue);

    await expect(
      enqueueAiRun(owner, { taskType: "content_plan", entityId, idempotencyKey: "create-4" }, deps),
    ).rejects.toThrow("QUEUE_UNAVAILABLE");
    expect(deps.repository.runs).toEqual([]);
  });

  test("returns NOT_FOUND for a cross-owner status lookup", async () => {
    const deps = dependencies();
    const { aiRunId } = await enqueueAiRun(
      owner,
      { taskType: "content_plan", entityId, idempotencyKey: "create-5" },
      deps,
    );
    await expect(getAiRun(other, aiRunId, deps.repository)).rejects.toThrow("NOT_FOUND");
    await expect(getAiRun(owner, aiRunId, deps.repository)).resolves.toMatchObject({
      id: aiRunId,
      status: "processing",
    });
    const publicStatus = await getAiRun(owner, aiRunId, deps.repository);
    expect(publicStatus).not.toHaveProperty("owner");
    expect(publicStatus).not.toHaveProperty("idempotencyKey");
    expect(publicStatus).not.toHaveProperty("inputHash");
    expect(publicStatus).not.toHaveProperty("model");
  });
});
