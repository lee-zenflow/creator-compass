import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { CreatorCompassDatabase } from "@/server/db/client";
import {
  contentPlans,
  creationProjects,
  guestSessions,
  aiRuns,
  promptVersions,
  reports,
  retrievalRecords,
  tasks,
} from "@/server/db/schema";

export function createDbFixtures(database: CreatorCompassDatabase) {
  return {
    async activeGuest() {
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [guest] = await database
        .insert(guestSessions)
        .values({ tokenHash, expiresAt })
        .returning();

      if (!guest) {
        throw new Error("Guest fixture was not created.");
      }

      return { guest, rawToken };
    },

    async createGuestTask(input: { guestSessionId: string; title?: string }) {
      const [project] = await database
        .insert(creationProjects)
        .values({
          guestSessionId: input.guestSessionId,
          contentType: "text",
          platform: "fixture",
          goal: "Exercise task ownership",
        })
        .returning();

      if (!project) {
        throw new Error("Creation project fixture was not created.");
      }

      const [report] = await database
        .insert(reports)
        .values({
          guestSessionId: input.guestSessionId,
          type: "creation",
          title: "Fixture report",
          status: "ready",
        })
        .returning();

      if (!report) {
        throw new Error("Report fixture was not created.");
      }

      const [prompt] = await database
        .insert(promptVersions)
        .values({
          taskType: "content_plan",
          version: randomInt(1, 2_000_000_000),
          template: "Fixture-only content-plan prompt",
          enabled: false,
        })
        .returning();
      const [retrieval] = await database
        .insert(retrievalRecords)
        .values({
          guestSessionId: input.guestSessionId,
          queryHash: randomBytes(32).toString("hex"),
        })
        .returning();
      if (!prompt || !retrieval) throw new Error("AI lineage fixture was not created.");
      const [aiRun] = await database
        .insert(aiRuns)
        .values({
          guestSessionId: input.guestSessionId,
          taskType: "content_plan",
          creationProjectId: project.id,
          idempotencyKey: randomUUID(),
          model: "fixture-model",
          promptVersionId: prompt.id,
          retrievalRecordId: retrieval.id,
          status: "ready",
          inputHash: randomBytes(32).toString("hex"),
          safeInputMetadata: {
            inputKind: "creation_request",
            fieldCount: 1,
            characterCountBucket: "1-500",
          },
        })
        .returning();
      if (!aiRun) throw new Error("AI run fixture was not created.");

      const [plan] = await database
        .insert(contentPlans)
        .values({
          guestSessionId: input.guestSessionId,
          reportId: report.id,
          creationProjectId: project.id,
          title: "Fixture plan",
          body: "Fixture content plan",
          generationMode: "ai",
          model: aiRun.model,
          promptVersionId: prompt.id,
          retrievalRecordId: retrieval.id,
          aiRunId: aiRun.id,
          status: "ready",
        })
        .returning();

      if (!plan) {
        throw new Error("Content plan fixture was not created.");
      }

      const [task] = await database
        .insert(tasks)
        .values({
          guestSessionId: input.guestSessionId,
          title: input.title ?? "Fixture task",
          sourceReportId: report.id,
          sourceVersion: plan.version,
          sourceClientId: "fixture-task",
          idempotencyKey: `fixture:${plan.id}`,
          sourceSnapshot: { contentPlanId: plan.id, version: plan.version, fixture: true },
          reason: "Database ownership fixture",
          steps: ["Complete fixture task"],
          plannedDate: "2026-08-09",
          estimatedMinutes: 30,
          completionCriteria: "Fixture is complete",
          sortOrder: 0,
        })
        .returning();

      if (!task) {
        throw new Error("Task fixture was not created.");
      }

      return task;
    },

    tasksForUser(userId: string) {
      return database.select().from(tasks).where(eq(tasks.userId, userId));
    },
  };
}
