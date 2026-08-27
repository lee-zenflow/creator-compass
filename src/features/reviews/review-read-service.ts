import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import {
  aiRuns, knowledgeSources, metricSnapshots, reviewReports, reviews,
} from "@/server/db/schema";
import { reviewActionSchema, reviewCitationSchema, type ReviewReportOutput } from "./review-report-schemas";

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function stringArray(input: unknown) {
  return z.array(z.string()).parse(input);
}

export function parseStoredReviewCitations(input: unknown) {
  const exact = z.array(reviewCitationSchema).max(8).safeParse(input);
  if (exact.success) return { citationMode: "exact" as const, citations: exact.data, legacySourceIds: [] };
  const legacy = z.array(z.uuid()).max(8).safeParse(input);
  if (legacy.success) return { citationMode: "legacy" as const, citations: [], legacySourceIds: legacy.data };
  throw new Error("INVALID_REVIEW_CITATIONS");
}

function toReport(row: typeof reviewReports.$inferSelect): ReviewReportOutput & {
  id: string; reportId: string; reviewId: string; version: number; generationMode: "ai" | "manual";
  status: "draft" | "processing" | "ready" | "failed" | "archived"; retrievalRecordId: string | null;
  parentVersion: number | null; citationRetrievalRecordId: string | null; citationMode: "exact" | "legacy"; legacySourceIds: string[];
} {
  const evidence = parseStoredReviewCitations(row.citations);
  return {
    id: row.id, reportId: row.reportId, reviewId: row.reviewId, version: row.version,
    generationMode: row.generationMode, status: row.status, retrievalRecordId: row.retrievalRecordId, parentVersion: row.parentVersion,
    dataSummary: z.record(z.string(), z.union([z.string(), z.number()])).parse(row.dataSummary),
    retained: stringArray(row.keep), problems: stringArray(row.problems), causes: stringArray(row.causes),
    actions: z.array(reviewActionSchema).parse(row.recommendations),
    ...evidence,
    citationRetrievalRecordId: row.retrievalRecordId,
  };
}

export function attachCitationProvenance<T extends {
  version: number;
  parentVersion: number | null;
  retrievalRecordId: string | null;
}>(reports: T[]): Array<T & { citationRetrievalRecordId: string | null }> {
  const byVersion = new Map(reports.map((report) => [report.version, report]));
  return reports.map((report) => {
    let cursor: T | undefined = report;
    const visited = new Set<number>();
    while (cursor && !cursor.retrievalRecordId && !visited.has(cursor.version)) {
      visited.add(cursor.version);
      cursor = cursor.parentVersion ? byVersion.get(cursor.parentVersion) : undefined;
    }
    return { ...report, citationRetrievalRecordId: cursor?.retrievalRecordId ?? null };
  });
}

export async function getReviewState(actor: CurrentActor, reviewId: string) {
  const id = z.uuid().parse(reviewId);
  const [review] = await db.select().from(reviews)
    .where(and(eq(reviews.id, id), actorWhere(actor, reviews))).limit(1);
  if (!review) throw new Error("NOT_FOUND");
  const snapshots = await db.select().from(metricSnapshots).where(eq(metricSnapshots.reviewId, id))
    .orderBy(desc(metricSnapshots.userConfirmedAt), desc(metricSnapshots.id)).limit(2);
  const reports = await db.select().from(reviewReports)
    .where(and(eq(reviewReports.reviewId, id), actorWhere(actor, reviewReports)))
    .orderBy(desc(reviewReports.version));
  const [run] = await db.select({
    id: aiRuns.id,
    status: aiRuns.status,
    errorCode: aiRuns.errorCode,
    safeErrorDetail: aiRuns.safeErrorDetail,
  })
    .from(aiRuns).where(and(eq(aiRuns.reviewId, id), eq(aiRuns.taskType, "review_report"), actorWhere(actor, aiRuns)))
    .orderBy(desc(aiRuns.createdAt)).limit(1);
  const parsedReports = attachCitationProvenance(reports.map(toReport));
  const latestReport = parsedReports[0] ?? null;
  return {
    review,
    latestSnapshot: snapshots[0] ?? null,
    previousSnapshot: snapshots[1] ?? null,
    reports: parsedReports,
    latestReport,
    latestRun: run ?? null,
  };
}

export async function getReviewReportVersion(actor: CurrentActor, reportId: string, version: number) {
  const parsed = z.object({ reportId: z.uuid(), version: z.number().int().positive() }).parse({ reportId, version });
  const rows = await db.select().from(reviewReports).where(and(
    eq(reviewReports.reportId, parsed.reportId), actorWhere(actor, reviewReports),
  )).orderBy(desc(reviewReports.version));
  const reports = attachCitationProvenance(rows.map(toReport));
  const report = reports.find((item) => item.version === parsed.version);
  if (!report) throw new Error("NOT_FOUND");
  return report;
}

export async function getLegacyReviewSources(sourceIds: string[]) {
  const ids = z.array(z.uuid()).max(8).parse(sourceIds);
  if (!ids.length) return [];
  const rows = await db.select({ id: knowledgeSources.id, name: knowledgeSources.name, publicUrl: knowledgeSources.publicUrl })
    .from(knowledgeSources).where(inArray(knowledgeSources.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}
