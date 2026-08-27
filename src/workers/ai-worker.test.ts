import { describe, expect, test, vi } from "vitest";

import { AiFailure } from "@/server/ai/deepseek-client";
import {
  handleAiJob,
  startAiWorker,
  type AiTaskFinalization,
  type AiTaskHandler,
  type AiWorkerRepository,
  type WorkerAiRun,
} from "./ai-worker";

const run: WorkerAiRun = {
  id: "50000000-0000-4000-8000-000000000001",
  taskType: "content_plan",
  status: "processing",
};

class MemoryWorkerRepository implements AiWorkerRepository {
  readonly transactionToken = { kind: "same-finalize-transaction" };
  gets = 0;
  allowFinalize = true;
  updates: Array<{ id: string; status: "ready" | "failed"; errorCode: string | null; safeErrorDetail: string | null }> = [];
  async getById(id: string) {
    this.gets += 1;
    return id === run.id ? run : null;
  }
  async finalizeSuccess(
    id: string,
    finalization: AiTaskFinalization,
    metadata: { durationMs: number },
  ) {
    if (!this.allowFinalize) return false;
    await finalization.persist(this.transactionToken as never);
    this.updates.push({ id, status: "ready", errorCode: null, safeErrorDetail: null, ...metadata });
    return true;
  }
  async markFailed(
    id: string,
    metadata: { errorCode: string | null; safeErrorDetail: string | null },
    finalization?: AiTaskFinalization,
  ) {
    if (finalization) await finalization.persist(this.transactionToken as never);
    this.updates.push({ id, status: "failed", ...metadata });
    return true;
  }
}

describe("AI worker job outcomes", () => {
  test("dead-letters an invalid payload before database access", async () => {
    const repository = new MemoryWorkerRepository();
    const result = await handleAiJob(
      { id: "job-invalid", data: { aiRunId: "not-a-uuid" }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      async () => ({ persist: async () => undefined }),
    );
    expect(result.status).toBe("deadletter");
    expect(repository.gets).toBe(0);
  });

  test("lets pg-boss retry a retryable failure without marking the run terminal", async () => {
    const repository = new MemoryWorkerRepository();
    const result = await handleAiJob(
      { id: "job-1", data: { aiRunId: run.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      async () => { throw new AiFailure("UPSTREAM_ERROR", "safe", true); },
    );
    expect(result.status).toBe("failed");
    expect(repository.updates).toEqual([]);
  });

  test("dead-letters non-retryable failures and stores only safe metadata", async () => {
    const repository = new MemoryWorkerRepository();
    const result = await handleAiJob(
      { id: "job-2", data: { aiRunId: run.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      { process: async () => { throw new AiFailure("INVALID_OUTPUT", "private generated output", false); } },
    );
    expect(result.status).toBe("deadletter");
    expect(repository.updates).toMatchObject([
      {
        id: run.id,
        status: "failed",
        errorCode: "INVALID_OUTPUT",
        safeErrorDetail: "AI response did not match the required format.",
      },
    ]);
    expect(JSON.stringify(repository.updates)).not.toContain("private generated output");
  });

  test("runs terminal failure release in the same transaction as the failed status", async () => {
    const repository = new MemoryWorkerRepository();
    let receivedTransaction: unknown;
    const handler: AiTaskHandler = {
      process: async () => { throw new AiFailure("INVALID_OUTPUT", "private", false); },
      onTerminalFailure: async () => ({
        persist: async (transaction) => { receivedTransaction = transaction; },
      }),
    };
    await handleAiJob(
      { id: "job-release", data: { aiRunId: run.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      handler,
    );
    expect(receivedTransaction).toBe(repository.transactionToken);
    expect(repository.updates[0]).toMatchObject({ status: "failed" });
  });

  test("registers consumers only for task types with implemented handlers", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const offWork = vi.fn().mockResolvedValue(undefined);
    const boss = {
      start: vi.fn().mockResolvedValue(undefined),
      createQueue: vi.fn().mockResolvedValue(undefined),
      work,
      offWork,
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const handler: AiTaskHandler = { process: async () => ({ persist: async () => undefined }) };
    const worker = await startAiWorker(
      { profile_extract: handler, positioning_report: handler },
      new MemoryWorkerRepository(),
      boss as never,
    );
    expect(work.mock.calls.map((call) => call[0])).toEqual([
      "ai-profile-extract",
      "ai-positioning-report",
    ]);
    await worker.stop();
    expect(offWork.mock.calls.map((call) => call[0])).toEqual([
      "ai-profile-extract",
      "ai-positioning-report",
    ]);
    expect(boss.stop).not.toHaveBeenCalled();
  });

  test("marks a retryable failure terminal only after the third total attempt", async () => {
    const repository = new MemoryWorkerRepository();
    const result = await handleAiJob(
      { id: "job-3", data: { aiRunId: run.id }, retryCount: 2, retryLimit: 2, signal: new AbortController().signal },
      repository,
      async () => { throw new AiFailure("RATE_LIMITED", "safe", true); },
    );
    expect(result.status).toBe("deadletter");
    expect(repository.updates[0]).toMatchObject({ status: "failed", errorCode: "RATE_LIMITED" });
  });

  test("marks a successfully persisted result ready", async () => {
    const repository = new MemoryWorkerRepository();
    let receivedTransaction: unknown;
    const result = await handleAiJob(
      { id: "job-4", data: { aiRunId: run.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      async () => ({ persist: async (transaction) => { receivedTransaction = transaction; } }),
    );
    expect(result.status).toBe("completed");
    expect(repository.updates[0]).toMatchObject({ status: "ready", errorCode: null });
    expect(receivedTransaction).toBe(repository.transactionToken);
  });

  test("does not complete a job when the ready CAS updates zero rows", async () => {
    const repository = new MemoryWorkerRepository();
    repository.allowFinalize = false;
    const result = await handleAiJob(
      { id: "job-cas", data: { aiRunId: run.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal },
      repository,
      async () => ({ persist: async () => undefined }),
    );
    expect(result.status).toBe("deadletter");
    expect(repository.updates).toEqual([]);
  });
});
