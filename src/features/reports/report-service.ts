import { and, desc, eq, isNull, max, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  contentPlans,
  positioningReports,
  reports,
  reviewReports,
} from "@/server/db/schema";

const reportTypeSchema = z.enum(["positioning", "creation", "review"]);
const reportStatusSchema = z.enum(["draft", "processing", "ready", "failed", "archived"]);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const jsonArraySchema = z.array(z.unknown());

const generationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ai"),
    model: z.string().trim().min(1).max(120),
    promptVersionId: z.uuid(),
    retrievalRecordId: z.uuid(),
    aiRunId: z.uuid(),
    schemaVersion: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal("manual"),
    parentVersion: z.number().int().positive(),
    schemaVersion: z.number().int().positive().default(1),
  }),
]);

const reportRootSchema = z.object({
  reportId: z.uuid().optional(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(1000).nullable().optional(),
  status: reportStatusSchema,
});

const versionBase = {
  status: reportStatusSchema,
  generation: generationSchema,
  confirmedAt: z.coerce.date().nullable().optional(),
};

export const appendReportVersionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("positioning"),
    root: reportRootSchema,
    version: z.object({
      ...versionBase,
      positioningSessionId: z.uuid(),
      candidates: jsonArraySchema,
      selectedCandidate: jsonObjectSchema.nullable().optional(),
      evidence: jsonArraySchema,
    }),
  }),
  z.object({
    type: z.literal("creation"),
    root: reportRootSchema,
    version: z.object({
      ...versionBase,
      creationProjectId: z.uuid(),
      title: z.string().trim().min(1).max(200),
      outline: jsonArraySchema,
      body: z.string().max(100_000),
      mediaSuggestions: jsonArraySchema,
      platformSuggestions: jsonArraySchema,
      citations: jsonArraySchema,
    }),
  }),
  z.object({
    type: z.literal("review"),
    root: reportRootSchema,
    version: z.object({
      ...versionBase,
      reviewId: z.uuid(),
      dataSummary: jsonObjectSchema,
      keep: jsonArraySchema,
      problems: jsonArraySchema,
      causes: jsonArraySchema,
      recommendations: jsonArraySchema,
      citations: jsonArraySchema,
    }),
  }),
]);

export type ReportType = z.infer<typeof reportTypeSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type AppendReportVersionInput = z.input<typeof appendReportVersionSchema>;
type ParsedAppendReportVersionInput = z.output<typeof appendReportVersionSchema>;

export type ReportRecord = {
  id: string;
  owner: CurrentActor;
  type: ReportType;
  title: string;
  summary: string | null;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ReportVersionRecord = {
  id: string;
  reportId: string;
  owner: CurrentActor;
  type: ReportType;
  version: number;
  status: ReportStatus;
  createdAt: Date;
};

export interface ReportRepository {
  transaction<T>(work: (repository: ReportRepository) => Promise<T>): Promise<T>;
  lockRoot(actor: CurrentActor, reportId: string): Promise<void>;
  listRoots(actor: CurrentActor, type?: ReportType, view?: "active" | "archived"): Promise<ReportRecord[]>;
  getRoot(actor: CurrentActor, reportId: string): Promise<ReportRecord | null>;
  updateRootStatus(
    actor: CurrentActor,
    reportId: string,
    status: ReportStatus,
  ): Promise<ReportRecord | null>;
  listVersions(actor: CurrentActor, root: ReportRecord): Promise<ReportVersionRecord[]>;
  createRoot(
    actor: CurrentActor,
    input: Omit<ReportRecord, "id" | "owner" | "createdAt" | "updatedAt">,
  ): Promise<ReportRecord>;
  nextVersion(actor: CurrentActor, root: ReportRecord): Promise<number>;
  insertVersion(
    actor: CurrentActor,
    root: ReportRecord,
    version: number,
    input: ParsedAppendReportVersionInput,
  ): Promise<ReportVersionRecord>;
}

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

function toReportRecord(row: typeof reports.$inferSelect): ReportRecord {
  return {
    id: row.id,
    owner: ownerFromRow(row),
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function generationValues(generation: ParsedAppendReportVersionInput["version"]["generation"]) {
  return generation.mode === "ai"
    ? {
        generationMode: "ai" as const,
        model: generation.model,
        promptVersionId: generation.promptVersionId,
        retrievalRecordId: generation.retrievalRecordId,
        aiRunId: generation.aiRunId,
        schemaVersion: generation.schemaVersion,
        parentVersion: null,
      }
    : {
        generationMode: "manual" as const,
        model: null,
        promptVersionId: null,
        retrievalRecordId: null,
        aiRunId: null,
        schemaVersion: generation.schemaVersion,
        parentVersion: generation.parentVersion,
      };
}

function createDatabaseReportRepository(
  database: CreatorCompassDatabase,
): ReportRepository {
  return {
    async transaction(work) {
      return database.transaction(async (transaction) =>
        work(createDatabaseReportRepository(transaction as unknown as CreatorCompassDatabase)),
      );
    },
    async lockRoot(actor, reportId) {
      const ownerPredicate =
        actor.kind === "user"
          ? sql`"user_id" = ${actor.userId} and "guest_session_id" is null`
          : sql`"guest_session_id" = ${actor.guestSessionId} and "user_id" is null`;
      await database.execute(
        sql`select "id" from "reports" where "id" = ${reportId} and ${ownerPredicate} for update`,
      );
    },
    async listRoots(actor, type, view = "active") {
      const conditions = [actorWhere(actor, reports)];
      if (type) conditions.push(eq(reports.type, type));
      conditions.push(view === "archived" ? eq(reports.status, "archived") : ne(reports.status, "archived"));
      const rows = await database
        .select()
        .from(reports)
        .where(and(...conditions))
        .orderBy(desc(reports.updatedAt), desc(reports.createdAt));
      return rows.map(toReportRecord);
    },
    async getRoot(actor, reportId) {
      const [row] = await database
        .select()
        .from(reports)
        .where(and(eq(reports.id, reportId), actorWhere(actor, reports)))
        .limit(1);
      return row ? toReportRecord(row) : null;
    },
    async updateRootStatus(actor, reportId, status) {
      const [row] = await database
        .update(reports)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(reports.id, reportId), actorWhere(actor, reports)))
        .returning();
      return row ? toReportRecord(row) : null;
    },
    async listVersions(actor, root) {
      if (root.type === "positioning") {
        const rows = await database
          .select({
            id: positioningReports.id,
            reportId: positioningReports.reportId,
            userId: positioningReports.userId,
            guestSessionId: positioningReports.guestSessionId,
            version: positioningReports.version,
            status: positioningReports.status,
            createdAt: positioningReports.createdAt,
          })
          .from(positioningReports)
          .where(and(eq(positioningReports.reportId, root.id), actorWhere(actor, positioningReports)))
          .orderBy(desc(positioningReports.version));
        return rows.map((row) => ({ ...row, owner: ownerFromRow(row), type: root.type }));
      }
      if (root.type === "creation") {
        const rows = await database
          .select({
            id: contentPlans.id,
            reportId: contentPlans.reportId,
            userId: contentPlans.userId,
            guestSessionId: contentPlans.guestSessionId,
            version: contentPlans.version,
            status: contentPlans.status,
            createdAt: contentPlans.createdAt,
          })
          .from(contentPlans)
          .where(and(eq(contentPlans.reportId, root.id), actorWhere(actor, contentPlans)))
          .orderBy(desc(contentPlans.version));
        return rows.map((row) => ({ ...row, owner: ownerFromRow(row), type: root.type }));
      }
      const rows = await database
        .select({
          id: reviewReports.id,
          reportId: reviewReports.reportId,
          userId: reviewReports.userId,
          guestSessionId: reviewReports.guestSessionId,
          version: reviewReports.version,
          status: reviewReports.status,
          createdAt: reviewReports.createdAt,
        })
        .from(reviewReports)
        .where(and(eq(reviewReports.reportId, root.id), actorWhere(actor, reviewReports)))
        .orderBy(desc(reviewReports.version));
      return rows.map((row) => ({ ...row, owner: ownerFromRow(row), type: root.type }));
    },
    async createRoot(actor, input) {
      const [row] = await database
        .insert(reports)
        .values({ ...input, ...ownerValues(actor) })
        .returning();
      if (!row) throw new Error("REPORT_CREATE_FAILED");
      return toReportRecord(row);
    },
    async nextVersion(actor, root) {
      const table = root.type === "positioning"
        ? positioningReports
        : root.type === "creation"
          ? contentPlans
          : reviewReports;
      const [result] = await database
        .select({ value: max(table.version) })
        .from(table)
        .where(and(eq(table.reportId, root.id), actorWhere(actor, table)));
      return (result?.value ?? 0) + 1;
    },
    async insertVersion(actor, root, version, input) {
      const common = {
        reportId: root.id,
        version,
        status: input.version.status,
        confirmedAt: input.version.confirmedAt ?? null,
        ...generationValues(input.version.generation),
        ...ownerValues(actor),
      };
      let record: ReportVersionRecord;
      if (input.type === "positioning") {
        const [row] = await database
          .insert(positioningReports)
          .values({
            ...common,
            positioningSessionId: input.version.positioningSessionId,
            candidates: input.version.candidates,
            selectedCandidate: input.version.selectedCandidate ?? null,
            evidence: input.version.evidence,
          })
          .returning();
        if (!row) throw new Error("REPORT_VERSION_CREATE_FAILED");
        record = { id: row.id, reportId: row.reportId, owner: actor, type: input.type, version: row.version, status: row.status, createdAt: row.createdAt };
      } else if (input.type === "creation") {
        const [row] = await database
          .insert(contentPlans)
          .values({
            ...common,
            creationProjectId: input.version.creationProjectId,
            title: input.version.title,
            outline: input.version.outline,
            body: input.version.body,
            mediaSuggestions: input.version.mediaSuggestions,
            platformSuggestions: input.version.platformSuggestions,
            citations: input.version.citations,
          })
          .returning();
        if (!row) throw new Error("REPORT_VERSION_CREATE_FAILED");
        record = { id: row.id, reportId: row.reportId, owner: actor, type: input.type, version: row.version, status: row.status, createdAt: row.createdAt };
      } else {
        const [row] = await database
          .insert(reviewReports)
          .values({
            ...common,
            reviewId: input.version.reviewId,
            dataSummary: input.version.dataSummary,
            keep: input.version.keep,
            problems: input.version.problems,
            causes: input.version.causes,
            recommendations: input.version.recommendations,
            citations: input.version.citations,
          })
          .returning();
        if (!row) throw new Error("REPORT_VERSION_CREATE_FAILED");
        record = { id: row.id, reportId: row.reportId, owner: actor, type: input.type, version: row.version, status: row.status, createdAt: row.createdAt };
      }

      await database
        .update(reports)
        .set({
          title: input.root.title,
          summary: input.root.summary ?? null,
          status: input.root.status,
          updatedAt: new Date(),
        })
        .where(and(eq(reports.id, root.id), actorWhere(actor, reports)));
      return record;
    },
  };
}

export const databaseReportRepository = createDatabaseReportRepository(db);

export function listReports(
  actor: CurrentActor,
  type?: ReportType,
  repository: ReportRepository = databaseReportRepository,
  view: "active" | "archived" = "active",
) {
  return repository.listRoots(actor, type ? reportTypeSchema.parse(type) : undefined, view);
}

export async function getReport(
  actor: CurrentActor,
  reportId: string,
  repository: ReportRepository = databaseReportRepository,
) {
  const parsedReportId = z.uuid().parse(reportId);
  const root = await repository.getRoot(actor, parsedReportId);
  if (!root) throw new Error("NOT_FOUND");
  const versions = await repository.listVersions(actor, root);
  return {
    root,
    versions: [...versions].sort((left, right) => right.version - left.version),
  };
}

/** Domain workflows append typed versions through this boundary; no generic update is exposed. */
export async function appendReportVersion(
  actor: CurrentActor,
  input: AppendReportVersionInput,
  repository: ReportRepository = databaseReportRepository,
) {
  const parsed = appendReportVersionSchema.parse(input);
  const generation = parsed.version.generation;
  if (generation.mode === "manual" && !parsed.root.reportId) {
    throw new Error("INVALID_PARENT_VERSION");
  }
  return repository.transaction(async (transaction) => {
    let root: ReportRecord;
    if (parsed.root.reportId) {
      const existing = await transaction.getRoot(actor, parsed.root.reportId);
      if (!existing || existing.type !== parsed.type) throw new Error("NOT_FOUND");
      await transaction.lockRoot(actor, existing.id);
      root = existing;
    } else {
      root = await transaction.createRoot(actor, {
        type: parsed.type,
        title: parsed.root.title,
        summary: parsed.root.summary ?? null,
        status: parsed.root.status,
      });
      await transaction.lockRoot(actor, root.id);
    }
    const versionNumber = await transaction.nextVersion(actor, root);
    if (generation.mode === "manual") {
      const versions = await transaction.listVersions(actor, root);
      const parentExists = versions.some(
        (version) => version.version === generation.parentVersion,
      );
      if (
        !parentExists ||
        generation.parentVersion >= versionNumber
      ) {
        throw new Error("INVALID_PARENT_VERSION");
      }
    }
    const version = await transaction.insertVersion(actor, root, versionNumber, parsed);
    return {
      root: {
        ...root,
        title: parsed.root.title,
        summary: parsed.root.summary ?? null,
        status: parsed.root.status,
      },
      version,
    };
  });
}

/** Stable domain contract consumed by positioning, creation, and review workflows. */
export const createReportVersion = appendReportVersion;

export async function archiveReport(
  actor: CurrentActor,
  reportId: string,
  repository: ReportRepository = databaseReportRepository,
) {
  const id = z.uuid().parse(reportId);
  return repository.transaction(async (transaction) => {
    await transaction.lockRoot(actor, id);
    const root = await transaction.getRoot(actor, id);
    if (!root) throw new Error("NOT_FOUND");
    const archived = await transaction.updateRootStatus(actor, id, "archived");
    if (!archived) throw new Error("NOT_FOUND");
    return archived;
  });
}

export async function restoreReport(
  actor: CurrentActor,
  reportId: string,
  repository: ReportRepository = databaseReportRepository,
) {
  const id = z.uuid().parse(reportId);
  return repository.transaction(async (transaction) => {
    await transaction.lockRoot(actor, id);
    const root = await transaction.getRoot(actor, id);
    if (!root) throw new Error("NOT_FOUND");
    const versions = await transaction.listVersions(actor, root);
    const latest = [...versions].sort((left, right) => right.version - left.version)[0];
    if (!latest) throw new Error("NOT_FOUND");
    const restored = await transaction.updateRootStatus(actor, id, latest.status);
    if (!restored) throw new Error("NOT_FOUND");
    return restored;
  });
}
