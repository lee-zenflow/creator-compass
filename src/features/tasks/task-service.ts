import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { isDeepStrictEqual } from "node:util";

import { logSafeAnalyticsFailure, trackProductEvent } from "@/features/analytics/analytics-service";
import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  contentPlans,
  positioningReports,
  reports,
  reviewReports,
  tasks,
} from "@/server/db/schema";
import {
  batchTaskStatusSchema,
  commitTasksInputSchema,
  moveTaskSchema,
  taskIdSchema,
  taskUpdateSchema,
  type CommitTasksInput,
  type TaskStatus,
  type TaskUpdate,
} from "./task-schemas";

export type { TaskStatus } from "./task-schemas";
export type ReportType = "positioning" | "creation" | "review";

export type ReportVersionSnapshot = {
  report: { id: string; type: ReportType; title: string };
  version: number;
  typedVersionId: string;
  entityId: string;
  snapshot: Record<string, unknown>;
};

export type TaskSourceSnapshot = {
  report: ReportVersionSnapshot["report"];
  typedVersion: {
    id: string;
    entityId: string | null;
    version: number;
    snapshot: Record<string, unknown>;
  };
  proposedTask: {
    clientId: string;
    title: string;
    reason: string;
    steps: string[];
    plannedDate: string;
    estimatedMinutes: number;
    completionCriteria: string;
    priority: 1 | 2 | 3;
  };
};

export type CommitTaskRecord = {
  title: string;
  sourceReportId: string;
  sourceVersion: number;
  sourceClientId: string;
  idempotencyKey: string;
  sourceSnapshot: TaskSourceSnapshot;
  reason: string;
  steps: string[];
  plannedDate: string;
  estimatedMinutes: number;
  completionCriteria: string;
  priority: 1 | 2 | 3;
  sortOrder: number;
};

export type TaskRecord = CommitTaskRecord & {
  id: string;
  owner: CurrentActor;
  status: TaskStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskFilter = {
  status?: TaskStatus;
  range?: "today" | "week" | "all";
};

export interface TaskRepository {
  transaction<T>(work: (repository: TaskRepository) => Promise<T>): Promise<T>;
  lockIdempotency?(actor: CurrentActor, idempotencyKey: string): Promise<void>;
  findReportVersion(
    actor: CurrentActor,
    sourceReportId: string,
    sourceVersion: number,
  ): Promise<ReportVersionSnapshot | null>;
  findByIdempotency(actor: CurrentActor, idempotencyKey: string): Promise<TaskRecord[]>;
  insertMany(actor: CurrentActor, records: CommitTaskRecord[]): Promise<TaskRecord[]>;
  list(actor: CurrentActor, filter?: TaskFilter): Promise<TaskRecord[]>;
  get(actor: CurrentActor, taskId: string): Promise<TaskRecord | null>;
  getManyForUpdate(actor: CurrentActor, taskIds: string[]): Promise<TaskRecord[]>;
  updateManyStatus(
    actor: CurrentActor,
    taskIds: string[],
    status: TaskStatus,
    completedAt: Date | null,
  ): Promise<TaskRecord[]>;
  listForDateForUpdate(actor: CurrentActor, plannedDate: string): Promise<TaskRecord[]>;
  setSortOrders(
    actor: CurrentActor,
    plannedDate: string,
    values: Array<{ id: string; sortOrder: number }>,
  ): Promise<void>;
  update(actor: CurrentActor, taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null>;
  delete(actor: CurrentActor, taskId: string): Promise<boolean>;
}

type TaskDatabase = CreatorCompassDatabase;

function actorWhere(
  actor: CurrentActor,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

function ownerFromRow(row: { userId: string | null; guestSessionId: string | null }): CurrentActor {
  if (row.userId) return { kind: "user", userId: row.userId, role: "user" };
  if (row.guestSessionId) return { kind: "guest", guestSessionId: row.guestSessionId };
  throw new Error("INVALID_OWNER");
}

function toTaskRecord(row: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: row.id,
    owner: ownerFromRow(row),
    title: row.title,
    sourceReportId: row.sourceReportId,
    sourceVersion: row.sourceVersion,
    sourceClientId: row.sourceClientId,
    idempotencyKey: row.idempotencyKey,
    sourceSnapshot: row.sourceSnapshot as TaskSourceSnapshot,
    reason: row.reason,
    steps: row.steps,
    plannedDate: row.plannedDate,
    estimatedMinutes: row.estimatedMinutes,
    completionCriteria: row.completionCriteria,
    priority: row.priority as 1 | 2 | 3,
    sortOrder: row.sortOrder,
    status: row.status,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDatabaseTaskRepository(database: TaskDatabase): TaskRepository {
  return {
    async transaction(work) {
      return database.transaction(async (transaction) =>
        work(createDatabaseTaskRepository(transaction as unknown as TaskDatabase)),
      );
    },
    async lockIdempotency(actor, idempotencyKey) {
      const ownerKey = actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
      await database.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${ownerKey}:${idempotencyKey}`}))`,
      );
    },
    async findReportVersion(actor, sourceReportId, sourceVersion) {
      const [root] = await database
        .select({ id: reports.id, type: reports.type, title: reports.title })
        .from(reports)
        .where(and(eq(reports.id, sourceReportId), actorWhere(actor, reports)))
        .limit(1);
      if (!root) return null;

      if (root.type === "positioning") {
        const [version] = await database
          .select()
          .from(positioningReports)
          .where(
            and(
              eq(positioningReports.reportId, sourceReportId),
              eq(positioningReports.version, sourceVersion),
              actorWhere(actor, positioningReports),
            ),
          )
          .limit(1);
        return version
          ? {
              report: root,
              version: version.version,
              typedVersionId: version.id,
              entityId: version.positioningSessionId,
              snapshot: { status: version.status, confirmedAt: version.confirmedAt?.toISOString() ?? null },
            }
          : null;
      }
      if (root.type === "creation") {
        const [version] = await database
          .select()
          .from(contentPlans)
          .where(
            and(
              eq(contentPlans.reportId, sourceReportId),
              eq(contentPlans.version, sourceVersion),
              actorWhere(actor, contentPlans),
            ),
          )
          .limit(1);
        return version
          ? {
              report: root,
              version: version.version,
              typedVersionId: version.id,
              entityId: version.creationProjectId,
              snapshot: { status: version.status, title: version.title },
            }
          : null;
      }
      const [version] = await database
        .select()
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.reportId, sourceReportId),
            eq(reviewReports.version, sourceVersion),
            actorWhere(actor, reviewReports),
          ),
        )
        .limit(1);
      return version
        ? {
            report: root,
            version: version.version,
            typedVersionId: version.id,
            entityId: version.reviewId,
            snapshot: { status: version.status, confirmedAt: version.confirmedAt?.toISOString() ?? null },
          }
        : null;
    },
    async findByIdempotency(actor, idempotencyKey) {
      const rows = await database
        .select()
        .from(tasks)
        .where(and(actorWhere(actor, tasks), eq(tasks.idempotencyKey, idempotencyKey)))
        .orderBy(asc(tasks.sortOrder));
      return rows.map(toTaskRecord);
    },
    async insertMany(actor, records) {
      if (records.length === 0) return [];
      const rows = await database
        .insert(tasks)
        .values(records.map((record) => ({ ...record, ...ownerValues(actor) })))
        .returning();
      return rows.map(toTaskRecord);
    },
    async list(actor, filter = {}) {
      const conditions = [actorWhere(actor, tasks)];
      if (filter.status) conditions.push(eq(tasks.status, filter.status));
      if (filter.range === "today") conditions.push(sql`${tasks.plannedDate} = timezone('Asia/Shanghai', now())::date`);
      if (filter.range === "week") {
        conditions.push(
          sql`${tasks.plannedDate} between date_trunc('week', timezone('Asia/Shanghai', now()))::date and (date_trunc('week', timezone('Asia/Shanghai', now())) + interval '6 days')::date`,
        );
      }
      const rows = await database
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.plannedDate), asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id));
      return rows.map(toTaskRecord);
    },
    async get(actor, taskId) {
      const [row] = await database
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), actorWhere(actor, tasks)))
        .limit(1);
      return row ? toTaskRecord(row) : null;
    },
    async getManyForUpdate(actor, taskIds) {
      if (taskIds.length === 0) return [];
      const rows = await database
        .select()
        .from(tasks)
        .where(and(inArray(tasks.id, taskIds), actorWhere(actor, tasks)))
        .orderBy(asc(tasks.id))
        .for("update");
      return rows.map(toTaskRecord);
    },
    async updateManyStatus(actor, taskIds, status, completedAt) {
      if (taskIds.length === 0) return [];
      const rows = await database
        .update(tasks)
        .set({ status, completedAt, updatedAt: new Date() })
        .where(and(inArray(tasks.id, taskIds), actorWhere(actor, tasks)))
        .returning();
      return rows.map(toTaskRecord);
    },
    async listForDateForUpdate(actor, plannedDate) {
      const rows = await database
        .select()
        .from(tasks)
        .where(and(
          actorWhere(actor, tasks),
          eq(tasks.plannedDate, plannedDate),
          ne(tasks.status, "dismissed"),
        ))
        .orderBy(asc(tasks.id))
        .for("update");
      return rows
        .map(toTaskRecord)
        .sort((left, right) =>
          left.sortOrder - right.sortOrder ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
        );
    },
    async setSortOrders(actor, plannedDate, values) {
      for (const value of values) {
        const updated = await database
          .update(tasks)
          .set({ sortOrder: value.sortOrder, updatedAt: new Date() })
          .where(and(
            eq(tasks.id, value.id),
            eq(tasks.plannedDate, plannedDate),
            ne(tasks.status, "dismissed"),
            actorWhere(actor, tasks),
          ))
          .returning({ id: tasks.id });
        if (updated.length !== 1) throw new Error("NOT_FOUND");
      }
    },
    async update(actor, taskId, patch) {
      const values: Partial<typeof tasks.$inferInsert> = {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.reason === undefined ? {} : { reason: patch.reason }),
        ...(patch.steps === undefined ? {} : { steps: patch.steps }),
        ...(patch.plannedDate === undefined ? {} : { plannedDate: patch.plannedDate }),
        ...(patch.estimatedMinutes === undefined ? {} : { estimatedMinutes: patch.estimatedMinutes }),
        ...(patch.completionCriteria === undefined ? {} : { completionCriteria: patch.completionCriteria }),
        ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
        updatedAt: new Date(),
      };
      const [row] = await database
        .update(tasks)
        .set(values)
        .where(and(eq(tasks.id, taskId), actorWhere(actor, tasks)))
        .returning();
      return row ? toTaskRecord(row) : null;
    },
    async delete(actor, taskId) {
      const deleted = await database
        .delete(tasks)
        .where(and(eq(tasks.id, taskId), actorWhere(actor, tasks)))
        .returning({ id: tasks.id });
      return deleted.length === 1;
    },
  };
}

export const databaseTaskRepository = createDatabaseTaskRepository(db);

function assertIdempotentRetry(existing: TaskRecord[], input: CommitTasksInput) {
  const expectedTasks = input.tasks
    .filter((task) => task.selected)
    .sort((left, right) => left.order - right.order)
    .map(({ clientId, title, reason, steps, plannedDate, estimatedMinutes, completionCriteria, priority }) => ({
      clientId,
      title,
      reason,
      steps,
      plannedDate,
      estimatedMinutes,
      completionCriteria,
      priority,
    }));
  const existingTasks = [...existing]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((task) => task.sourceSnapshot.proposedTask);
  const sameSource = existing.every(
    (task) => task.sourceReportId === input.sourceReportId && task.sourceVersion === input.sourceVersion,
  );
  if (!sameSource || !isDeepStrictEqual(existingTasks, expectedTasks)) {
    throw new Error("IDEMPOTENCY_KEY_REUSED");
  }
}

export async function commitTasks(
  actor: CurrentActor,
  input: CommitTasksInput,
  repository: TaskRepository = databaseTaskRepository,
  track: typeof trackProductEvent = trackProductEvent,
) {
  const parsed = commitTasksInputSchema.parse(input);
  const outcome = await repository.transaction(async (transaction) => {
    await transaction.lockIdempotency?.(actor, parsed.idempotencyKey);
    const source = await transaction.findReportVersion(
      actor,
      parsed.sourceReportId,
      parsed.sourceVersion,
    );
    if (!source) throw new Error("NOT_FOUND");

    const existing = await transaction.findByIdempotency(actor, parsed.idempotencyKey);
    if (existing.length > 0) {
      assertIdempotentRetry(existing, parsed);
      return {
        inserted: false,
        records: [...existing].sort((left, right) => left.sortOrder - right.sortOrder),
        source,
      };
    }

    const selected = parsed.tasks
      .map((task, inputIndex) => ({ task, inputIndex }))
      .filter(({ task }) => task.selected)
      .sort((left, right) => left.task.order - right.task.order || left.inputIndex - right.inputIndex);

    const records: CommitTaskRecord[] = selected.map(({ task }, sortOrder) => ({
      title: task.title,
      sourceReportId: parsed.sourceReportId,
      sourceVersion: parsed.sourceVersion,
      sourceClientId: task.clientId,
      idempotencyKey: parsed.idempotencyKey,
      sourceSnapshot: {
        report: source.report,
        typedVersion: {
          id: source.typedVersionId,
          entityId: source.entityId,
          version: source.version,
          snapshot: source.snapshot,
        },
        proposedTask: {
          clientId: task.clientId,
          title: task.title,
          reason: task.reason,
          steps: task.steps,
          plannedDate: task.plannedDate,
          estimatedMinutes: task.estimatedMinutes,
          completionCriteria: task.completionCriteria,
          priority: task.priority,
        },
      },
      reason: task.reason,
      steps: task.steps,
      plannedDate: task.plannedDate,
      estimatedMinutes: task.estimatedMinutes,
      completionCriteria: task.completionCriteria,
      priority: task.priority,
      sortOrder,
    }));
    return { inserted: true, records: await transaction.insertMany(actor, records), source };
  });
  if (outcome.inserted && outcome.records.length > 0) {
    await track(actor, {
      eventName: "tasks_saved",
      flow: outcome.source.report.type,
      entityVersion: outcome.source.version,
      metadata: { itemCount: outcome.records.length },
    }).catch(logSafeAnalyticsFailure);
  }
  return outcome.records;
}

export function listTasks(
  actor: CurrentActor,
  filter: TaskFilter = {},
  repository: TaskRepository = databaseTaskRepository,
) {
  return repository.list(actor, filter);
}

export async function getTask(
  actor: CurrentActor,
  taskId: string,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsedTaskId = taskIdSchema.parse(taskId);
  const task = await repository.get(actor, parsedTaskId);
  if (!task) throw new Error("NOT_FOUND");
  return task;
}

export async function updateTask(
  actor: CurrentActor,
  taskId: string,
  patch: TaskUpdate,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsedTaskId = taskIdSchema.parse(taskId);
  const parsed = taskUpdateSchema.parse(patch);
  const task = await repository.update(actor, parsedTaskId, parsed);
  if (!task) throw new Error("NOT_FOUND");
  return task;
}

export async function startTask(
  actor: CurrentActor,
  taskId: string,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsedTaskId = taskIdSchema.parse(taskId);
  return repository.transaction(async (transaction) => {
    const [task] = await transaction.getManyForUpdate(actor, [parsedTaskId]);
    if (!task) throw new Error("NOT_FOUND");
    if (task.status !== "pending") throw new Error("INVALID_TASK_TRANSITION");
    const updated = await transaction.update(actor, task.id, {
      status: "in_progress",
      completedAt: null,
    });
    if (!updated) throw new Error("NOT_FOUND");
    return updated;
  });
}

export async function batchUpdateTaskStatus(
  actor: CurrentActor,
  input: unknown,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsed = batchTaskStatusSchema.parse(input);
  return repository.transaction(async (transaction) => {
    const locked = await transaction.getManyForUpdate(actor, parsed.taskIds);
    if (locked.length !== parsed.taskIds.length) throw new Error("NOT_FOUND");

    const lockedById = new Map(locked.map((task) => [task.id, task]));
    const ordered = parsed.taskIds.map((id) => lockedById.get(id)!);
    const invalid = ordered.some((task) => task.status === "dismissed" || (
      parsed.targetStatus === "pending"
        ? task.status !== "completed" && task.status !== "pending"
        : !["pending", "in_progress", "completed"].includes(task.status)
    ));
    if (invalid) throw new Error("INVALID_TASK_TRANSITION");

    const changedBeforeWrite = ordered.filter((task) => task.status !== parsed.targetStatus);
    const unchanged = ordered.filter((task) => task.status === parsed.targetStatus);
    const updated = changedBeforeWrite.length === 0
      ? []
      : await transaction.updateManyStatus(
          actor,
          changedBeforeWrite.map((task) => task.id),
          parsed.targetStatus,
          parsed.targetStatus === "completed" ? new Date() : null,
        );
    if (updated.length !== changedBeforeWrite.length) throw new Error("NOT_FOUND");
    const updatedById = new Map(updated.map((task) => [task.id, task]));

    return {
      changed: changedBeforeWrite.map((task) => updatedById.get(task.id)!),
      unchanged,
    };
  });
}

export async function moveTask(
  actor: CurrentActor,
  input: unknown,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsed = moveTaskSchema.parse(input);
  return repository.transaction(async (transaction) => {
    const selected = await transaction.get(actor, parsed.taskId);
    if (!selected) throw new Error("NOT_FOUND");
    if (selected.status === "dismissed") throw new Error("INVALID_TASK_TRANSITION");

    const locked = await transaction.listForDateForUpdate(actor, selected.plannedDate);
    const currentIndex = locked.findIndex((task) => task.id === parsed.taskId);
    if (currentIndex < 0) throw new Error("NOT_FOUND");
    const adjacentIndex = parsed.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (adjacentIndex < 0 || adjacentIndex >= locked.length) return locked;

    const reordered = [...locked];
    [reordered[currentIndex], reordered[adjacentIndex]] = [
      reordered[adjacentIndex]!,
      reordered[currentIndex]!,
    ];
    const normalized = reordered.map((task, sortOrder) => ({ ...task, sortOrder }));
    await transaction.setSortOrders(
      actor,
      selected.plannedDate,
      normalized.map((task) => ({ id: task.id, sortOrder: task.sortOrder })),
    );
    return normalized;
  });
}

export async function completeTask(
  actor: CurrentActor,
  taskId: string,
  repository: TaskRepository = databaseTaskRepository,
) {
  const result = await batchUpdateTaskStatus(actor, {
    taskIds: [taskId],
    targetStatus: "completed",
  }, repository);
  return result.changed[0] ?? result.unchanged[0]!;
}

export async function restoreTask(
  actor: CurrentActor,
  taskId: string,
  repository: TaskRepository = databaseTaskRepository,
) {
  const result = await batchUpdateTaskStatus(actor, {
    taskIds: [taskId],
    targetStatus: "pending",
  }, repository);
  return result.changed[0] ?? result.unchanged[0]!;
}

export async function deleteTask(
  actor: CurrentActor,
  taskId: string,
  repository: TaskRepository = databaseTaskRepository,
) {
  const parsedTaskId = taskIdSchema.parse(taskId);
  if (!(await repository.delete(actor, parsedTaskId))) throw new Error("NOT_FOUND");
}
