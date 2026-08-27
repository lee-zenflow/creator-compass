import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  batchUpdateTaskStatus,
  commitTasks,
  completeTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  restoreTask,
  startTask,
  updateTask,
  type CommitTaskRecord,
  type ReportVersionSnapshot,
  type TaskRecord,
  type TaskRepository,
} from "./task-service";
import {
  batchTaskStatusSchema,
  moveTaskSchema,
  taskInputSchema,
  taskStatusSchema,
  type ProposedTask,
} from "./task-schemas";

const owner: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const other: CurrentActor = { kind: "user", userId: "20000000-0000-4000-8000-000000000002", role: "user" };
const reportId = "30000000-0000-4000-8000-000000000003";
const firstId = "60000000-0000-4000-8000-000000000006";
const secondId = "70000000-0000-4000-8000-000000000007";
const thirdId = "80000000-0000-4000-8000-000000000008";

test("uses the same Asia Shanghai day boundary for today and week lists", () => {
  const source = readFileSync("src/features/tasks/task-service.ts", "utf8");
  expect(source).toContain("timezone('Asia/Shanghai', now())::date");
  expect(source).not.toContain("= current_date");
});

const proposed: ProposedTask[] = [
  {
    clientId: "skip",
    selected: false,
    order: 0,
    title: "跳过",
    reason: "不在本轮执行",
    steps: ["忽略"],
    plannedDate: "2026-08-09",
    estimatedMinutes: 10,
    completionCriteria: "无需提交",
    priority: 3,
  },
  {
    clientId: "write",
    selected: true,
    order: 2,
    title: "写出初稿",
    reason: "验证内容方向",
    steps: ["列提纲", "完成初稿"],
    plannedDate: "2026-08-10",
    estimatedMinutes: 30,
    completionCriteria: "初稿保存完成",
    priority: 1,
  },
  {
    clientId: "collect",
    selected: true,
    order: 1,
    title: "补充素材",
    reason: "提升案例可信度",
    steps: ["整理两个案例"],
    plannedDate: "2026-08-09",
    estimatedMinutes: 20,
    completionCriteria: "两个案例进入素材库",
    priority: 2,
  },
];

class MemoryTaskRepository implements TaskRepository {
  records: TaskRecord[] = [];
  inserts = 0;
  statusWrites = 0;
  private sequence = 0;

  constructor(
    private readonly versions: Array<{
      actor: CurrentActor;
      value: ReportVersionSnapshot;
    }> = [],
  ) {}

  async transaction<T>(work: (repository: TaskRepository) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.records);
    const statusWrites = this.statusWrites;
    try {
      return await work(this);
    } catch (error) {
      this.records = snapshot;
      this.statusWrites = statusWrites;
      throw error;
    }
  }

  async findReportVersion(actor: CurrentActor, sourceReportId: string, sourceVersion: number) {
    return this.versions.find(
      (entry) =>
        actorKey(entry.actor) === actorKey(actor) &&
        entry.value.report.id === sourceReportId &&
        entry.value.version === sourceVersion,
    )?.value ?? null;
  }

  async findByIdempotency(actor: CurrentActor, idempotencyKey: string) {
    return this.records.filter(
      (record) => actorKey(record.owner) === actorKey(actor) && record.idempotencyKey === idempotencyKey,
    );
  }

  async insertMany(actor: CurrentActor, records: CommitTaskRecord[]) {
    this.inserts += records.length;
    const inserted = records.map((record) => ({
      ...record,
      id: `80000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      owner: actor,
      status: "pending" as const,
      completedAt: null,
      createdAt: new Date("2026-08-08T12:00:00Z"),
      updatedAt: new Date("2026-08-08T12:00:00Z"),
    }));
    this.records.push(...inserted);
    return inserted;
  }

  async list(actor: CurrentActor, filter: { status?: TaskRecord["status"] } = {}) {
    return this.records.filter(
      (record) => actorKey(record.owner) === actorKey(actor) && (!filter.status || record.status === filter.status),
    );
  }

  async get(actor: CurrentActor, taskId: string) {
    return this.records.find(
      (record) => record.id === taskId && actorKey(record.owner) === actorKey(actor),
    ) ?? null;
  }

  async getManyForUpdate(actor: CurrentActor, taskIds: string[]) {
    const ids = new Set(taskIds);
    return this.records.filter(
      (record) => ids.has(record.id) && actorKey(record.owner) === actorKey(actor),
    );
  }

  async updateManyStatus(
    actor: CurrentActor,
    taskIds: string[],
    status: TaskRecord["status"],
    completedAt: Date | null,
  ) {
    const ids = new Set(taskIds);
    const updated = this.records.filter(
      (record) => ids.has(record.id) && actorKey(record.owner) === actorKey(actor),
    );
    this.statusWrites += updated.length;
    updated.forEach((record) => Object.assign(record, {
      status,
      completedAt,
      updatedAt: new Date("2026-08-08T12:01:00Z"),
    }));
    return updated;
  }

  async listForDateForUpdate(actor: CurrentActor, plannedDate: string) {
    return this.records
      .filter(
        (record) =>
          actorKey(record.owner) === actorKey(actor) &&
          record.plannedDate === plannedDate &&
          record.status !== "dismissed",
      )
      .sort((left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
      );
  }

  async setSortOrders(
    actor: CurrentActor,
    plannedDate: string,
    values: Array<{ id: string; sortOrder: number }>,
  ) {
    for (const value of values) {
      const record = await this.get(actor, value.id);
      if (!record || record.plannedDate !== plannedDate || record.status === "dismissed") {
        throw new Error("NOT_FOUND");
      }
      record.sortOrder = value.sortOrder;
    }
  }

  async update(actor: CurrentActor, taskId: string, patch: Partial<TaskRecord>) {
    const record = await this.get(actor, taskId);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date("2026-08-08T12:01:00Z") });
    return record;
  }

  async delete(actor: CurrentActor, taskId: string) {
    const index = this.records.findIndex(
      (record) => record.id === taskId && actorKey(record.owner) === actorKey(actor),
    );
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }
}

function actorKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

function createRepository() {
  return new MemoryTaskRepository([
    {
      actor: owner,
      value: {
        report: { id: reportId, type: "creation", title: "首篇视频方案" },
        version: 2,
        typedVersionId: "40000000-0000-4000-8000-000000000004",
        entityId: "50000000-0000-4000-8000-000000000005",
        snapshot: { title: "用三步完成第一条视频", status: "ready" },
      },
    },
  ]);
}

function taskRecord(input: {
  id: string;
  owner: CurrentActor;
  status?: TaskRecord["status"];
  plannedDate?: string;
  sortOrder?: number;
  createdAt?: Date;
}): TaskRecord {
  return {
    id: input.id,
    owner: input.owner,
    title: `任务-${input.id.slice(0, 4)}`,
    sourceReportId: reportId,
    sourceVersion: 2,
    sourceClientId: input.id,
    idempotencyKey: `daily-${input.id}`,
    sourceSnapshot: {
      report: { id: reportId, type: "creation", title: "首篇视频方案" },
      typedVersion: {
        id: "40000000-0000-4000-8000-000000000004",
        entityId: "50000000-0000-4000-8000-000000000005",
        version: 2,
        snapshot: { status: "ready" },
      },
      proposedTask: {
        clientId: input.id,
        title: `任务-${input.id.slice(0, 4)}`,
        reason: "验证每日执行闭环",
        steps: ["完成任务"],
        plannedDate: input.plannedDate ?? "2026-08-20",
        estimatedMinutes: 20,
        completionCriteria: "任务完成",
        priority: 2,
      },
    },
    reason: "验证每日执行闭环",
    steps: ["完成任务"],
    plannedDate: input.plannedDate ?? "2026-08-20",
    estimatedMinutes: 20,
    completionCriteria: "任务完成",
    priority: 2,
    sortOrder: input.sortOrder ?? 0,
    status: input.status ?? "pending",
    completedAt: input.status === "completed" ? new Date("2026-08-20T08:00:00Z") : null,
    createdAt: input.createdAt ?? new Date(`2026-08-20T08:00:0${input.sortOrder ?? 0}Z`),
    updatedAt: new Date("2026-08-20T08:00:00Z"),
  };
}

function createRepositoryWithTasks(records: TaskRecord[]) {
  const repository = createRepository();
  repository.records = records;
  return repository;
}

describe("task input contract", () => {
  test("accepts only supported task states and exact daily command shapes", () => {
    expect(taskStatusSchema.options).toEqual(["pending", "in_progress", "completed", "dismissed"]);
    expect(batchTaskStatusSchema.parse({
      taskIds: [firstId, secondId, firstId],
      targetStatus: "completed",
    }).taskIds).toEqual([firstId, secondId]);
    expect(() => batchTaskStatusSchema.parse({
      taskIds: Array.from({ length: 51 }, (_, index) =>
        `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
      targetStatus: "completed",
    })).toThrow();
    expect(() => batchTaskStatusSchema.parse({ taskIds: [], targetStatus: "completed" })).toThrow();
    expect(() => batchTaskStatusSchema.parse({
      taskIds: [firstId],
      targetStatus: "completed",
      ownerId: owner.kind === "user" ? owner.userId : "",
    })).toThrow();
    expect(moveTaskSchema.parse({ taskId: firstId, direction: "up" })).toEqual({
      taskId: firstId,
      direction: "up",
    });
    expect(() => moveTaskSchema.parse({ taskId: firstId, direction: "left" })).toThrow();
  });

  test("keeps priority at the three product levels", () => {
    const base = { ...proposed[1], selected: undefined, order: undefined, clientId: undefined };
    expect(taskInputSchema.parse({ ...base, priority: 1 }).priority).toBe(1);
    expect(taskInputSchema.parse({ ...base, priority: 3 }).priority).toBe(3);
    expect(() => taskInputSchema.parse({ ...base, priority: 4 })).toThrow();
  });

  test("requires a date, five to 1440 minutes, and completion criteria", () => {
    const base = { ...proposed[1], selected: undefined, order: undefined, clientId: undefined };
    expect(() => taskInputSchema.parse({ ...base, estimatedMinutes: 4 })).toThrow();
    expect(() => taskInputSchema.parse({ ...base, estimatedMinutes: 1441 })).toThrow();
    expect(() => taskInputSchema.parse({ ...base, plannedDate: "2026-8-9" })).toThrow();
    expect(() => taskInputSchema.parse({ ...base, completionCriteria: "" })).toThrow();
  });

  test("rejects duplicate client IDs within one commit batch", async () => {
    const repository = createRepository();
    await expect(
      commitTasks(
        owner,
        {
          sourceReportId: reportId,
          sourceVersion: 2,
          idempotencyKey: "duplicate-client",
          tasks: [proposed[1]!, { ...proposed[2]!, clientId: proposed[1]!.clientId }],
        },
        repository,
      ),
    ).rejects.toThrow();
    expect(repository.inserts).toBe(0);
  });
});

describe("task conversion", () => {
  test("tracks a newly saved task batch with the persisted source version", async () => {
    const repository = createRepository();
    const track = vi.fn(async () => undefined);

    await commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "tracked-commit", tasks: [...proposed] },
      repository,
      track,
    );

    expect(track).toHaveBeenCalledWith(owner, {
      eventName: "tasks_saved",
      flow: "creation",
      entityVersion: 2,
      metadata: { itemCount: 2 },
    });
  });

  test("does not duplicate tasks_saved analytics on an idempotent retry", async () => {
    const repository = createRepository();
    const track = vi.fn(async () => undefined);
    const input = { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "tracked-retry", tasks: [...proposed] };

    await commitTasks(owner, input, repository, track);
    await commitTasks(owner, input, repository, track);

    expect(track).toHaveBeenCalledOnce();
  });

  test("keeps saved tasks when analytics fails and logs no failure detail", async () => {
    const repository = createRepository();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "tracking-fails", tasks: [...proposed] },
      repository,
      vi.fn(async () => { throw new Error("raw-task-input-must-not-leak"); }),
    );

    expect(result).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith("PRODUCT_ANALYTICS_WRITE_FAILED");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw-task-input-must-not-leak");
    consoleError.mockRestore();
  });

  test("does not track a task batch when the business write fails", async () => {
    const track = vi.fn(async () => undefined);

    await expect(commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 99, idempotencyKey: "missing-source", tasks: [...proposed] },
      createRepository(),
      track,
    )).rejects.toThrow("NOT_FOUND");

    expect(track).not.toHaveBeenCalled();
  });

  test("commits only selected tasks, compresses their order, and snapshots the typed report version", async () => {
    const repository = createRepository();
    const result = await commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "commit-1", tasks: [...proposed] },
      repository,
    );

    expect(result.map((task) => task.title)).toEqual(["补充素材", "写出初稿"]);
    expect(result.map((task) => task.sortOrder)).toEqual([0, 1]);
    expect(result[0]?.sourceSnapshot).toMatchObject({
      report: { id: reportId, type: "creation" },
      typedVersion: {
        id: "40000000-0000-4000-8000-000000000004",
        entityId: "50000000-0000-4000-8000-000000000005",
        version: 2,
      },
    });
  });

  test("allows two tasks in one idempotent batch and a retry adds no rows", async () => {
    const repository = createRepository();
    const input = { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "commit-2", tasks: [...proposed] };

    const first = await commitTasks(owner, input, repository);
    const retried = await commitTasks(owner, input, repository);

    expect(first).toHaveLength(2);
    expect(retried.map((task) => task.id)).toEqual(first.map((task) => task.id));
    expect(repository.inserts).toBe(2);
  });

  test("rejects an idempotency key reused for a different selected set", async () => {
    const repository = createRepository();
    const input = { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "commit-3", tasks: [...proposed] };
    await commitTasks(owner, input, repository);

    await expect(
      commitTasks(owner, { ...input, tasks: proposed.filter((task) => task.clientId !== "write") }, repository),
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
  });

  test("rejects changed task content even when the idempotency client IDs match", async () => {
    const repository = createRepository();
    const input = { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "commit-content", tasks: [...proposed] };
    await commitTasks(owner, input, repository);

    await expect(
      commitTasks(
        owner,
        {
          ...input,
          tasks: proposed.map((task) =>
            task.clientId === "write" ? { ...task, title: "同一ID但内容已变化" } : task,
          ),
        },
        repository,
      ),
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
  });

  test("returns NOT_FOUND and writes nothing for another actor or a missing typed version", async () => {
    const repository = createRepository();
    await expect(
      commitTasks(other, { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "commit-4", tasks: [...proposed] }, repository),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      commitTasks(owner, { sourceReportId: reportId, sourceVersion: 99, idempotencyKey: "commit-5", tasks: [...proposed] }, repository),
    ).rejects.toThrow("NOT_FOUND");
    expect(repository.inserts).toBe(0);
  });
});

describe("owned task CRUD", () => {
  test("lists, reads, updates, completes, restores, and deletes within one actor", async () => {
    const repository = createRepository();
    const [task] = await commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "crud-1", tasks: [proposed[1]] },
      repository,
    );
    expect(task).toBeDefined();

    expect(await listTasks(owner, {}, repository)).toHaveLength(1);
    expect((await getTask(owner, task!.id, repository)).title).toBe("写出初稿");
    expect((await updateTask(owner, task!.id, { title: "完成第一版" }, repository)).title).toBe("完成第一版");
    expect((await completeTask(owner, task!.id, repository)).status).toBe("completed");
    expect((await restoreTask(owner, task!.id, repository)).status).toBe("pending");
    await deleteTask(owner, task!.id, repository);
    expect(await listTasks(owner, {}, repository)).toHaveLength(0);
  });

  test("normalizes every cross-owner record lookup to NOT_FOUND", async () => {
    const repository = createRepository();
    const [task] = await commitTasks(
      owner,
      { sourceReportId: reportId, sourceVersion: 2, idempotencyKey: "crud-2", tasks: [proposed[1]] },
      repository,
    );

    await expect(getTask(other, task!.id, repository)).rejects.toThrow("NOT_FOUND");
    await expect(updateTask(other, task!.id, { title: "越权" }, repository)).rejects.toThrow("NOT_FOUND");
    await expect(completeTask(other, task!.id, repository)).rejects.toThrow("NOT_FOUND");
    await expect(deleteTask(other, task!.id, repository)).rejects.toThrow("NOT_FOUND");
  });

  test("rejects malformed task IDs before repository access", async () => {
    const repository = createRepository();
    await expect(getTask(owner, "not-a-uuid", repository)).rejects.toThrow();
    expect(repository.records).toHaveLength(0);
  });
});

describe("daily task state and ordering", () => {
  test("starts only a pending owned task", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "pending" }),
    ]);

    await expect(startTask(owner, firstId, repository)).resolves.toMatchObject({
      id: firstId,
      status: "in_progress",
      completedAt: null,
    });
    await expect(startTask(other, firstId, repository)).rejects.toThrow("NOT_FOUND");
    await expect(startTask(owner, firstId, repository)).rejects.toThrow("INVALID_TASK_TRANSITION");
  });

  test("updates a unique owned batch atomically and treats the target state as idempotent", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "pending" }),
      taskRecord({ id: secondId, owner, status: "completed" }),
    ]);

    const result = await batchUpdateTaskStatus(owner, {
      taskIds: [firstId, secondId, firstId],
      targetStatus: "completed",
    }, repository);

    expect(result.changed.map((item) => item.id)).toEqual([firstId]);
    expect(result.unchanged.map((item) => item.id)).toEqual([secondId]);
    expect(result.changed[0]?.completedAt).toBeInstanceOf(Date);
  });

  test("keeps completeTask on the atomic state machine and makes completed idempotent", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "in_progress" }),
      taskRecord({ id: secondId, owner, status: "completed" }),
      taskRecord({ id: thirdId, owner, status: "dismissed" }),
    ]);

    await expect(completeTask(owner, firstId, repository)).resolves.toMatchObject({
      status: "completed",
    });
    expect(repository.statusWrites).toBe(1);
    await expect(completeTask(owner, secondId, repository)).resolves.toMatchObject({
      status: "completed",
    });
    expect(repository.statusWrites).toBe(1);
    await expect(completeTask(owner, thirdId, repository))
      .rejects.toThrow("INVALID_TASK_TRANSITION");
  });

  test("keeps restoreTask on the atomic state machine and rejects non-completed states", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "completed" }),
      taskRecord({ id: secondId, owner, status: "pending" }),
      taskRecord({ id: thirdId, owner, status: "in_progress" }),
    ]);

    await expect(restoreTask(owner, firstId, repository)).resolves.toMatchObject({
      status: "pending",
      completedAt: null,
    });
    expect(repository.statusWrites).toBe(1);
    await expect(restoreTask(owner, secondId, repository)).resolves.toMatchObject({
      status: "pending",
    });
    expect(repository.statusWrites).toBe(1);
    await expect(restoreTask(owner, thirdId, repository))
      .rejects.toThrow("INVALID_TASK_TRANSITION");
  });

  test("rolls back the whole batch when one task belongs to another actor", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "pending" }),
      taskRecord({ id: secondId, owner: other, status: "pending" }),
    ]);

    await expect(batchUpdateTaskStatus(owner, {
      taskIds: [firstId, secondId],
      targetStatus: "completed",
    }, repository)).rejects.toThrow("NOT_FOUND");
    expect(repository.records.find((item) => item.id === firstId)?.status).toBe("pending");
  });

  test("rejects dismissed tasks and invalid restore transitions without partial writes", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "completed" }),
      taskRecord({ id: secondId, owner, status: "dismissed" }),
    ]);

    await expect(batchUpdateTaskStatus(owner, {
      taskIds: [firstId, secondId],
      targetStatus: "pending",
    }, repository)).rejects.toThrow("INVALID_TASK_TRANSITION");
    expect(repository.records.find((item) => item.id === firstId)?.status).toBe("completed");

    const inProgressRepository = createRepositoryWithTasks([
      taskRecord({ id: thirdId, owner, status: "in_progress" }),
    ]);
    await expect(batchUpdateTaskStatus(owner, {
      taskIds: [thirdId],
      targetStatus: "pending",
    }, inProgressRepository)).rejects.toThrow("INVALID_TASK_TRANSITION");
  });

  test("moves a task only inside its planned date and keeps contiguous ordering", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, plannedDate: "2026-08-20", sortOrder: 0 }),
      taskRecord({ id: secondId, owner, plannedDate: "2026-08-20", sortOrder: 1 }),
      taskRecord({ id: thirdId, owner, plannedDate: "2026-08-21", sortOrder: 0 }),
    ]);

    const result = await moveTask(owner, { taskId: secondId, direction: "up" }, repository);
    expect(result.map((item) => ({ id: item.id, sortOrder: item.sortOrder }))).toEqual([
      { id: secondId, sortOrder: 0 },
      { id: firstId, sortOrder: 1 },
    ]);
    expect(await repository.listForDateForUpdate(owner, "2026-08-21"))
      .toMatchObject([{ id: thirdId, sortOrder: 0 }]);
  });

  test("uses creation time then ID to resolve duplicate sort orders consistently", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({
        id: firstId,
        owner,
        sortOrder: 0,
        createdAt: new Date("2026-08-20T08:02:00Z"),
      }),
      taskRecord({
        id: secondId,
        owner,
        sortOrder: 0,
        createdAt: new Date("2026-08-20T08:01:00Z"),
      }),
    ]);

    const unchanged = await moveTask(owner, { taskId: secondId, direction: "up" }, repository);
    expect(unchanged.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(unchanged.map((item) => item.sortOrder)).toEqual([0, 0]);
  });

  test("returns an unchanged list at a move boundary and rejects cross-owner or dismissed moves", async () => {
    const repository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, plannedDate: "2026-08-20", sortOrder: 0 }),
      taskRecord({ id: secondId, owner, plannedDate: "2026-08-20", sortOrder: 1 }),
      taskRecord({ id: thirdId, owner, status: "dismissed", plannedDate: "2026-08-20", sortOrder: 2 }),
    ]);

    const unchanged = await moveTask(owner, { taskId: firstId, direction: "up" }, repository);
    expect(unchanged.map((item) => item.id)).toEqual([firstId, secondId]);
    await expect(moveTask(other, { taskId: firstId, direction: "down" }, repository))
      .rejects.toThrow("NOT_FOUND");
    await expect(moveTask(owner, { taskId: thirdId, direction: "up" }, repository))
      .rejects.toThrow("INVALID_TASK_TRANSITION");

    const dismissedNeighborRepository = createRepositoryWithTasks([
      taskRecord({ id: firstId, owner, status: "pending", sortOrder: 0 }),
      taskRecord({ id: thirdId, owner, status: "dismissed", sortOrder: 1 }),
    ]);
    const withoutDismissed = await moveTask(
      owner,
      { taskId: firstId, direction: "down" },
      dismissedNeighborRepository,
    );
    expect(withoutDismissed.map((item) => item.id)).toEqual([firstId]);
    expect(dismissedNeighborRepository.records.find((item) => item.id === thirdId)?.sortOrder).toBe(1);
  });
});
