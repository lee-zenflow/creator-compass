import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  resolveRunCitations,
  type CitationPair,
  type CitationView,
} from "@/features/citations/citation-service";
import { creationCitationSchema } from "@/features/creation/creation-schemas";
import { recoveryFor } from "@/features/ai/recovery-contract";
import type { CurrentActor } from "@/features/identity/current-actor";
import { positioningCandidateSchema } from "@/features/positioning/positioning-schemas";
import {
  getLegacyReviewSources,
  parseStoredReviewCitations,
} from "@/features/reviews/review-read-service";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  contentPlans,
  positioningReports,
  reports,
  reviewReports,
} from "@/server/db/schema";
import {
  type ReportRecord,
  type ReportStatus,
  type ReportType,
} from "./report-service";

const reportIdSchema = z.uuid();
const exactCitationPairSchema = z.object({ itemId: z.uuid(), sourceId: z.uuid() }).strict();

type AiStatus = Exclude<ReportStatus, "archived"> | "archived";

export type RawReportVersion = {
  id: string;
  reportId: string;
  type: ReportType;
  version: number;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  generationMode: "ai" | "manual";
  model: string | null;
  parentVersion: number | null;
  retrievalRecordId: string | null;
  aiRunId: string | null;
  aiStatus: AiStatus | null;
  aiErrorCode: string | null;
  aiSafeErrorDetail: string | null;
  entityId: string;
  storedCitations: unknown;
};

export type RawReportLatestVersionMeta = Pick<
  RawReportVersion,
  "reportId" | "type" | "version" | "generationMode" | "entityId"
>;

export type LegacyCitationSourceView = {
  id: string;
  name: string;
  publicUrl: string | null;
};

export type ReportDetailVersion = {
  id: string;
  version: number;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  generationMode: "ai" | "manual";
  model: string | null;
  parentVersion: number | null;
  entityId: string;
  domainHref: string;
  aiStatus: AiStatus | null;
  citations: CitationView[];
  citationMode: "exact" | "legacy";
  legacySources: LegacyCitationSourceView[];
  recoveryHref: string | null;
};

export type ReportDetail = {
  root: ReportRecord;
  versions: ReportDetailVersion[];
};

export interface ReportReadRepository {
  getRoot(actor: CurrentActor, reportId: string): Promise<ReportRecord | null>;
  listTypedVersions(actor: CurrentActor, root: ReportRecord): Promise<RawReportVersion[]>;
  listLatestVersionMeta(
    actor: CurrentActor,
    roots: ReportRecord[],
  ): Promise<RawReportLatestVersionMeta[]>;
}

function actorWhere(
  actor: CurrentActor,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function commonRow<T extends {
  id: string;
  reportId: string;
  version: number;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  generationMode: "ai" | "manual";
  model: string | null;
  parentVersion: number | null;
  retrievalRecordId: string | null;
  aiRunId: string | null;
  aiStatus: AiStatus | null;
  aiErrorCode: string | null;
  aiSafeErrorDetail: string | null;
}>(row: T, type: ReportType, entityId: string, storedCitations: unknown): RawReportVersion {
  return {
    id: row.id,
    reportId: row.reportId,
    type,
    version: row.version,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generationMode: row.generationMode,
    model: row.model,
    parentVersion: row.parentVersion,
    retrievalRecordId: row.retrievalRecordId,
    aiRunId: row.aiRunId,
    aiStatus: row.aiStatus,
    aiErrorCode: row.aiErrorCode,
    aiSafeErrorDetail: row.aiSafeErrorDetail,
    entityId,
    storedCitations,
  };
}

export function createDatabaseReportReadRepository(
  database: CreatorCompassDatabase,
): ReportReadRepository {
  return {
    async getRoot(actor, reportId) {
      const [row] = await database.select({
        id: reports.id,
        type: reports.type,
        title: reports.title,
        summary: reports.summary,
        status: reports.status,
        createdAt: reports.createdAt,
        updatedAt: reports.updatedAt,
      }).from(reports).where(and(eq(reports.id, reportId), actorWhere(actor, reports))).limit(1);
      return row ? { ...row, owner: actor } : null;
    },
    async listTypedVersions(actor, root) {
      const aiOwner = actorWhere(actor, aiRuns);
      if (root.type === "positioning") {
        const rows = await database.select({
          id: positioningReports.id,
          reportId: positioningReports.reportId,
          version: positioningReports.version,
          status: positioningReports.status,
          createdAt: positioningReports.createdAt,
          updatedAt: positioningReports.updatedAt,
          generationMode: positioningReports.generationMode,
          model: positioningReports.model,
          parentVersion: positioningReports.parentVersion,
          retrievalRecordId: positioningReports.retrievalRecordId,
          aiRunId: positioningReports.aiRunId,
          aiStatus: aiRuns.status,
          aiErrorCode: aiRuns.errorCode,
          aiSafeErrorDetail: aiRuns.safeErrorDetail,
          entityId: positioningReports.positioningSessionId,
          storedCitations: positioningReports.candidates,
        }).from(positioningReports)
          .leftJoin(aiRuns, and(eq(positioningReports.aiRunId, aiRuns.id), aiOwner))
          .where(and(
            eq(positioningReports.reportId, root.id),
            actorWhere(actor, positioningReports),
          ))
          .orderBy(desc(positioningReports.version));
        return rows.map((row) => commonRow(row, root.type, row.entityId, row.storedCitations));
      }
      if (root.type === "creation") {
        const rows = await database.select({
          id: contentPlans.id,
          reportId: contentPlans.reportId,
          version: contentPlans.version,
          status: contentPlans.status,
          createdAt: contentPlans.createdAt,
          updatedAt: contentPlans.updatedAt,
          generationMode: contentPlans.generationMode,
          model: contentPlans.model,
          parentVersion: contentPlans.parentVersion,
          retrievalRecordId: contentPlans.retrievalRecordId,
          aiRunId: contentPlans.aiRunId,
          aiStatus: aiRuns.status,
          aiErrorCode: aiRuns.errorCode,
          aiSafeErrorDetail: aiRuns.safeErrorDetail,
          entityId: contentPlans.creationProjectId,
          storedCitations: contentPlans.citations,
        }).from(contentPlans)
          .leftJoin(aiRuns, and(eq(contentPlans.aiRunId, aiRuns.id), aiOwner))
          .where(and(
            eq(contentPlans.reportId, root.id),
            actorWhere(actor, contentPlans),
          ))
          .orderBy(desc(contentPlans.version));
        return rows.map((row) => commonRow(row, root.type, row.entityId, row.storedCitations));
      }
      const rows = await database.select({
        id: reviewReports.id,
        reportId: reviewReports.reportId,
        version: reviewReports.version,
        status: reviewReports.status,
        createdAt: reviewReports.createdAt,
        updatedAt: reviewReports.updatedAt,
        generationMode: reviewReports.generationMode,
        model: reviewReports.model,
        parentVersion: reviewReports.parentVersion,
        retrievalRecordId: reviewReports.retrievalRecordId,
        aiRunId: reviewReports.aiRunId,
        aiStatus: aiRuns.status,
        aiErrorCode: aiRuns.errorCode,
        aiSafeErrorDetail: aiRuns.safeErrorDetail,
        entityId: reviewReports.reviewId,
        storedCitations: reviewReports.citations,
      }).from(reviewReports)
        .leftJoin(aiRuns, and(eq(reviewReports.aiRunId, aiRuns.id), aiOwner))
        .where(and(
          eq(reviewReports.reportId, root.id),
          actorWhere(actor, reviewReports),
        ))
        .orderBy(desc(reviewReports.version));
      return rows.map((row) => commonRow(row, root.type, row.entityId, row.storedCitations));
    },
    async listLatestVersionMeta(actor, roots) {
      const idsFor = (type: ReportType) => roots
        .filter((root) => root.type === type)
        .map((root) => root.id);
      const positioningIds = idsFor("positioning");
      const creationIds = idsFor("creation");
      const reviewIds = idsFor("review");
      const [positioning, creation, review] = await Promise.all([
        positioningIds.length === 0 ? [] : database
          .selectDistinctOn([positioningReports.reportId], {
            reportId: positioningReports.reportId,
            version: positioningReports.version,
            generationMode: positioningReports.generationMode,
            entityId: positioningReports.positioningSessionId,
          })
          .from(positioningReports)
          .where(and(
            inArray(positioningReports.reportId, positioningIds),
            actorWhere(actor, positioningReports),
          ))
          .orderBy(positioningReports.reportId, desc(positioningReports.version)),
        creationIds.length === 0 ? [] : database
          .selectDistinctOn([contentPlans.reportId], {
            reportId: contentPlans.reportId,
            version: contentPlans.version,
            generationMode: contentPlans.generationMode,
            entityId: contentPlans.creationProjectId,
          })
          .from(contentPlans)
          .where(and(
            inArray(contentPlans.reportId, creationIds),
            actorWhere(actor, contentPlans),
          ))
          .orderBy(contentPlans.reportId, desc(contentPlans.version)),
        reviewIds.length === 0 ? [] : database
          .selectDistinctOn([reviewReports.reportId], {
            reportId: reviewReports.reportId,
            version: reviewReports.version,
            generationMode: reviewReports.generationMode,
            entityId: reviewReports.reviewId,
          })
          .from(reviewReports)
          .where(and(
            inArray(reviewReports.reportId, reviewIds),
            actorWhere(actor, reviewReports),
          ))
          .orderBy(reviewReports.reportId, desc(reviewReports.version)),
      ]);
      return [
        ...positioning.map((row) => ({ ...row, type: "positioning" as const })),
        ...creation.map((row) => ({ ...row, type: "creation" as const })),
        ...review.map((row) => ({ ...row, type: "review" as const })),
      ];
    },
  };
}

export const databaseReportReadRepository = createDatabaseReportReadRepository(db);

export async function getReportsLatestMeta(
  actor: CurrentActor,
  roots: ReportRecord[],
  repository: ReportReadRepository = databaseReportReadRepository,
) {
  if (roots.length === 0) return [];
  const latest = await repository.listLatestVersionMeta(actor, roots);
  const byReportId = new Map(latest.map((version) => [version.reportId, version]));
  return roots.map((root) => {
    const version = byReportId.get(root.id);
    if (!version || version.type !== root.type) throw new Error("NOT_FOUND");
    return {
      reportId: root.id,
      version: version.version,
      generationMode: version.generationMode,
      domainHref: domainHref(version),
    };
  });
}

function uniquePairs(pairs: CitationPair[]) {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.itemId}:${pair.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exactPairs(version: RawReportVersion): {
  citationMode: "exact" | "legacy";
  pairs: CitationPair[];
  legacySourceIds: string[];
} {
  if (version.type === "positioning") {
    const candidates = z.array(positioningCandidateSchema).parse(version.storedCitations);
    const pairs = candidates.flatMap((candidate) => candidate.citations);
    return {
      citationMode: "exact",
      pairs: uniquePairs(z.array(exactCitationPairSchema).max(32).parse(pairs)),
      legacySourceIds: [],
    };
  }
  if (version.type === "creation") {
    const pairs = z.array(creationCitationSchema).max(8).parse(version.storedCitations);
    return {
      citationMode: "exact",
      pairs: uniquePairs(z.array(exactCitationPairSchema).max(8).parse(pairs)),
      legacySourceIds: [],
    };
  }
  const review = parseStoredReviewCitations(version.storedCitations);
  return review.citationMode === "exact"
    ? { citationMode: "exact", pairs: review.citations, legacySourceIds: [] }
    : { citationMode: "legacy", pairs: [], legacySourceIds: review.legacySourceIds };
}

function citationRetrievalId(version: RawReportVersion, byVersion: Map<number, RawReportVersion>) {
  let cursor: RawReportVersion | undefined = version;
  const visited = new Set<number>();
  while (cursor && !cursor.retrievalRecordId && !visited.has(cursor.version)) {
    visited.add(cursor.version);
    cursor = cursor.parentVersion ? byVersion.get(cursor.parentVersion) : undefined;
  }
  return cursor?.retrievalRecordId ?? null;
}

function domainHref(version: RawReportLatestVersionMeta) {
  const query = `report=${version.reportId}&version=${version.version}`;
  if (version.type === "positioning") return `/positioning/${version.entityId}/report?${query}`;
  if (version.type === "creation") return `/creation/${version.entityId}/plan?${query}`;
  return `/reviews/${version.entityId}/report?${query}`;
}

function recoveryHref(version: RawReportVersion, isLatest: boolean) {
  if (
    !isLatest ||
    version.generationMode !== "ai" ||
    !version.aiRunId ||
    version.aiStatus !== "failed" ||
    !recoveryFor(version.aiErrorCode, version.aiSafeErrorDetail).retryable
  ) return null;
  if (version.type === "positioning") return `/positioning/${version.entityId}`;
  if (version.type === "creation") return `/creation/${version.entityId}/plan`;
  return `/reviews/${version.entityId}/report`;
}

type ReportReadDependencies = {
  repository: ReportReadRepository;
  resolveCitations: typeof resolveRunCitations;
  resolveLegacySources: typeof getLegacyReviewSources;
};

export async function getReportDetail(
  actor: CurrentActor,
  reportId: string,
  dependencies: ReportReadDependencies = {
    repository: databaseReportReadRepository,
    resolveCitations: resolveRunCitations,
    resolveLegacySources: getLegacyReviewSources,
  },
): Promise<ReportDetail> {
  const id = reportIdSchema.parse(reportId);
  const root = await dependencies.repository.getRoot(actor, id);
  if (!root) throw new Error("NOT_FOUND");
  const rawVersions = await dependencies.repository.listTypedVersions(actor, root);
  const versions = [...rawVersions].sort((left, right) => right.version - left.version);
  const byVersion = new Map(versions.map((version) => [version.version, version]));
  const detailVersions = await Promise.all(versions.map(async (version, index): Promise<ReportDetailVersion> => {
    const evidence = exactPairs(version);
    const retrievalId = citationRetrievalId(version, byVersion);
    if (evidence.pairs.length > 0 && !retrievalId) throw new Error("INVALID_REPORT_PROVENANCE");
    const citations = retrievalId && evidence.citationMode === "exact"
      ? await dependencies.resolveCitations(actor, retrievalId, evidence.pairs)
      : [];
    const legacySources = evidence.citationMode === "legacy"
      ? await dependencies.resolveLegacySources(evidence.legacySourceIds)
      : [];
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      generationMode: version.generationMode,
      model: version.model,
      parentVersion: version.parentVersion,
      entityId: version.entityId,
      domainHref: domainHref(version),
      aiStatus: version.aiStatus,
      citations,
      citationMode: evidence.citationMode,
      legacySources,
      recoveryHref: recoveryHref(version, index === 0),
    };
  }));
  return { root, versions: detailVersions };
}
