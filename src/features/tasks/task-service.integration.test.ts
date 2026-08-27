import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import type { CreatorCompassDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration("task service with PostgreSQL", () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const database = drizzle({ client: pool, schema });

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    await pool.end();
  });

  test("commits two rows once, retries idempotently, and rejects another actor", async () => {
    const [{ createDatabaseTaskRepository, commitTasks }] = await Promise.all([
      import("./task-service"),
    ]);
    const repository = createDatabaseTaskRepository(
      database as unknown as CreatorCompassDatabase,
    );
    const guestId = randomUUID();
    const otherGuestId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await database.insert(schema.guestSessions).values([
      { id: guestId, tokenHash: randomBytes(32).toString("hex"), expiresAt },
      { id: otherGuestId, tokenHash: randomBytes(32).toString("hex"), expiresAt },
    ]);
    const actor: CurrentActor = { kind: "guest", guestSessionId: guestId };
    const other: CurrentActor = { kind: "guest", guestSessionId: otherGuestId };

    const [project] = await database
      .insert(schema.creationProjects)
      .values({
        guestSessionId: guestId,
        contentType: "video",
        platform: "douyin",
        goal: "integration test",
      })
      .returning();
    const [root] = await database
      .insert(schema.reports)
      .values({ guestSessionId: guestId, type: "creation", title: "integration report", status: "ready" })
      .returning();
    const [prompt] = await database
      .insert(schema.promptVersions)
      .values({
        taskType: "content_plan",
        version: Math.floor(Date.now() / 1000),
        template: "Integration-only content-plan prompt",
        enabled: false,
      })
      .returning();
    const [retrieval] = await database
      .insert(schema.retrievalRecords)
      .values({ guestSessionId: guestId, queryHash: randomBytes(32).toString("hex") })
      .returning();
    const [aiRun] = await database
      .insert(schema.aiRuns)
      .values({
        guestSessionId: guestId,
        taskType: "content_plan",
        creationProjectId: project!.id,
        idempotencyKey: randomUUID(),
        model: "integration-model",
        promptVersionId: prompt!.id,
        retrievalRecordId: retrieval!.id,
        status: "ready",
        inputHash: randomBytes(32).toString("hex"),
        safeInputMetadata: {
          inputKind: "creation_request",
          fieldCount: 1,
          characterCountBucket: "1-500",
        },
      })
      .returning();
    const [plan] = await database
      .insert(schema.contentPlans)
      .values({
        guestSessionId: guestId,
        reportId: root!.id,
        creationProjectId: project!.id,
        title: "integration plan",
        body: "body",
        generationMode: "ai",
        model: aiRun!.model,
        promptVersionId: prompt!.id,
        retrievalRecordId: retrieval!.id,
        aiRunId: aiRun!.id,
        status: "ready",
      })
      .returning();

    const input = {
      sourceReportId: root!.id,
      sourceVersion: plan!.version,
      idempotencyKey: randomUUID(),
      tasks: [
        {
          clientId: "a",
          selected: true,
          order: 0,
          title: "任务A",
          reason: "原因A",
          steps: ["步骤A"],
          plannedDate: "2026-08-09",
          estimatedMinutes: 20,
          completionCriteria: "完成A",
          priority: 1 as const,
        },
        {
          clientId: "b",
          selected: true,
          order: 1,
          title: "任务B",
          reason: "原因B",
          steps: ["步骤B"],
          plannedDate: "2026-08-10",
          estimatedMinutes: 30,
          completionCriteria: "完成B",
          priority: 2 as const,
        },
      ],
    };

    const first = await commitTasks(actor, input, repository);
    const retry = await commitTasks(actor, input, repository);
    expect(first).toHaveLength(2);
    expect(retry.map((task) => task.id)).toEqual(first.map((task) => task.id));
    await expect(commitTasks(other, input, repository)).rejects.toThrow("NOT_FOUND");
  });

  test("keeps batch writes owner-scoped and rolls back when one ID is not owned", async () => {
    const [{ createDatabaseTaskRepository, batchUpdateTaskStatus }] = await Promise.all([
      import("./task-service"),
    ]);
    const repository = createDatabaseTaskRepository(
      database as unknown as CreatorCompassDatabase,
    );
    const guestId = randomUUID();
    const otherGuestId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await database.insert(schema.guestSessions).values([
      { id: guestId, tokenHash: randomBytes(32).toString("hex"), expiresAt },
      { id: otherGuestId, tokenHash: randomBytes(32).toString("hex"), expiresAt },
    ]);
    const actor: CurrentActor = { kind: "guest", guestSessionId: guestId };

    const [ownerRoot, otherRoot] = await database.insert(schema.reports).values([
      { guestSessionId: guestId, type: "creation", title: "owner batch report", status: "ready" },
      { guestSessionId: otherGuestId, type: "creation", title: "other batch report", status: "ready" },
    ]).returning();
    const common = {
      sourceVersion: 1,
      reason: "integration reason",
      steps: ["integration step"],
      plannedDate: "2026-08-20",
      estimatedMinutes: 20,
      completionCriteria: "integration complete",
      priority: 2,
      sortOrder: 0,
      status: "pending" as const,
    };
    const [ownedTask, otherTask] = await database.insert(schema.tasks).values([
      {
        ...common,
        guestSessionId: guestId,
        title: "owned task",
        sourceReportId: ownerRoot!.id,
        sourceClientId: randomUUID(),
        idempotencyKey: randomUUID(),
        sourceSnapshot: {},
      },
      {
        ...common,
        guestSessionId: otherGuestId,
        title: "other task",
        sourceReportId: otherRoot!.id,
        sourceClientId: randomUUID(),
        idempotencyKey: randomUUID(),
        sourceSnapshot: {},
      },
    ]).returning();

    await expect(batchUpdateTaskStatus(actor, {
      taskIds: [ownedTask!.id, otherTask!.id],
      targetStatus: "completed",
    }, repository)).rejects.toThrow("NOT_FOUND");

    const [unchanged] = await database.select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, ownedTask!.id));
    expect(unchanged?.status).toBe("pending");
  });
});
