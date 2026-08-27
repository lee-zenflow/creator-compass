import { and, desc, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  aiRuns,
  creatorProfiles,
  interviewMessages,
  positioningReports,
  positioningSessions,
} from "@/server/db/schema";
import { positioningCandidateSchema, type PositioningCandidate } from "./positioning-schemas";

export type PositioningStatus = "draft" | "processing" | "ready" | "failed" | "archived";
export type PositioningSessionRecord = {
  id: string;
  status: PositioningStatus;
  completeness: number;
  currentStep: number;
  createdAt: Date;
  updatedAt: Date;
  draft?: Record<string, unknown>;
};
export type InterviewMessageRecord = {
  id: string;
  sender: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};
export type PositioningRunRecord = {
  id: string;
  taskType: "profile_extract" | "positioning_report";
  status: PositioningStatus;
  errorCode: string | null;
  safeErrorDetail: string | null;
  updatedAt: Date;
};
export type PositioningReportRecord = {
  id: string;
  positioningSessionId?: string;
  reportId: string;
  version: number;
  status: PositioningStatus;
  generationMode: "manual" | "ai";
  candidates: unknown[];
  evidence?: unknown[];
  selectedCandidate: Record<string, unknown> | null;
  retrievalRecordId?: string | null;
};
export type ActiveCreatorProfile = {
  id: string;
  version: number;
  currentPositioning: string | null;
  targetAudience: string | null;
  contentDirection: string | null;
  profileDimensions: Record<string, unknown>;
  updatedAt: Date;
};

export interface PositioningReadRepository {
  listSessions(actor: CurrentActor): Promise<PositioningSessionRecord[]>;
  getSession(actor: CurrentActor, sessionId: string): Promise<PositioningSessionRecord | null>;
  listMessages(actor: CurrentActor, sessionId: string): Promise<InterviewMessageRecord[]>;
  getLatestRun(actor: CurrentActor, sessionId: string): Promise<PositioningRunRecord | null>;
  getLatestReport(actor: CurrentActor, sessionId: string): Promise<PositioningReportRecord | null>;
  getReportVersion(actor: CurrentActor, reportId: string, version: number): Promise<PositioningReportRecord | null>;
  getActiveProfile(actor: CurrentActor): Promise<ActiveCreatorProfile | null>;
}

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

export function createDatabasePositioningReadRepository(database: CreatorCompassDatabase): PositioningReadRepository {
  return {
    async listSessions(actor) {
      return database.select({
        id: positioningSessions.id,
        status: positioningSessions.status,
        completeness: positioningSessions.completeness,
        currentStep: positioningSessions.currentStep,
        createdAt: positioningSessions.createdAt,
        updatedAt: positioningSessions.updatedAt,
      }).from(positioningSessions)
        .where(actorWhere(actor, positioningSessions))
        .orderBy(desc(positioningSessions.updatedAt), desc(positioningSessions.id));
    },
    async getSession(actor, sessionId) {
      const [row] = await database.select({
        id: positioningSessions.id,
        status: positioningSessions.status,
        completeness: positioningSessions.completeness,
        currentStep: positioningSessions.currentStep,
        draft: positioningSessions.draft,
        createdAt: positioningSessions.createdAt,
        updatedAt: positioningSessions.updatedAt,
      }).from(positioningSessions)
        .where(and(eq(positioningSessions.id, sessionId), actorWhere(actor, positioningSessions)))
        .limit(1);
      return row ?? null;
    },
    async listMessages(actor, sessionId) {
      const session = await this.getSession(actor, sessionId);
      if (!session) return [];
      return database.select({
        id: interviewMessages.id,
        sender: interviewMessages.sender,
        content: interviewMessages.content,
        createdAt: interviewMessages.createdAt,
      }).from(interviewMessages)
        .where(eq(interviewMessages.positioningSessionId, sessionId))
        .orderBy(interviewMessages.createdAt, interviewMessages.id);
    },
    async getLatestRun(actor, sessionId) {
      const [row] = await database.select({
        id: aiRuns.id,
        taskType: aiRuns.taskType,
        status: aiRuns.status,
        errorCode: aiRuns.errorCode,
        safeErrorDetail: aiRuns.safeErrorDetail,
        updatedAt: aiRuns.updatedAt,
      }).from(aiRuns)
        .where(and(eq(aiRuns.positioningSessionId, sessionId), actorWhere(actor, aiRuns)))
        .orderBy(desc(aiRuns.createdAt), desc(aiRuns.id)).limit(1);
      if (!row || (row.taskType !== "profile_extract" && row.taskType !== "positioning_report")) return null;
      return { ...row, taskType: row.taskType };
    },
    async getLatestReport(actor, sessionId) {
      const [row] = await database.select({
        id: positioningReports.id,
        positioningSessionId: positioningReports.positioningSessionId,
        reportId: positioningReports.reportId,
        version: positioningReports.version,
        status: positioningReports.status,
        generationMode: positioningReports.generationMode,
        candidates: positioningReports.candidates,
        evidence: positioningReports.evidence,
        selectedCandidate: positioningReports.selectedCandidate,
        retrievalRecordId: positioningReports.retrievalRecordId,
      }).from(positioningReports)
        .where(and(eq(positioningReports.positioningSessionId, sessionId), eq(positioningReports.generationMode, "ai"), actorWhere(actor, positioningReports)))
        .orderBy(desc(positioningReports.version), desc(positioningReports.createdAt)).limit(1);
      return row ?? null;
    },
    async getReportVersion(actor, reportId, version) {
      const [row] = await database.select({
        id: positioningReports.id,
        positioningSessionId: positioningReports.positioningSessionId,
        reportId: positioningReports.reportId,
        version: positioningReports.version,
        status: positioningReports.status,
        generationMode: positioningReports.generationMode,
        candidates: positioningReports.candidates,
        evidence: positioningReports.evidence,
        selectedCandidate: positioningReports.selectedCandidate,
        retrievalRecordId: positioningReports.retrievalRecordId,
      }).from(positioningReports)
        .where(and(eq(positioningReports.reportId, reportId), eq(positioningReports.version, version), actorWhere(actor, positioningReports)))
        .limit(1);
      return row ?? null;
    },
    async getActiveProfile(actor) {
      const [row] = await database.select({
        id: creatorProfiles.id,
        version: creatorProfiles.version,
        currentPositioning: creatorProfiles.currentPositioning,
        targetAudience: creatorProfiles.targetAudience,
        contentDirection: creatorProfiles.contentDirection,
        profileDimensions: creatorProfiles.profileDimensions,
        updatedAt: creatorProfiles.updatedAt,
      }).from(creatorProfiles).where(actorWhere(actor, creatorProfiles)).limit(1);
      return row ?? null;
    },
  };
}

export const databasePositioningReadRepository = createDatabasePositioningReadRepository(db);

export function listPositioningRecords(
  actor: CurrentActor,
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  return repository.listSessions(actor);
}

export async function getPositioningFlow(
  actor: CurrentActor,
  sessionId: string,
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  const session = await repository.getSession(actor, sessionId);
  if (!session) throw new Error("NOT_FOUND");
  const [messages, latestRun, latestReport] = await Promise.all([
    repository.listMessages(actor, sessionId),
    repository.getLatestRun(actor, sessionId),
    repository.getLatestReport(actor, sessionId),
  ]);
  return { session, messages, latestRun, latestReport };
}

export async function getPositioningReportForSession(
  actor: CurrentActor,
  sessionId: string,
  source?: { reportId: string; version: number },
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  const session = await repository.getSession(actor, sessionId);
  if (!session) throw new Error("NOT_FOUND");
  if (!source) {
    const latest = await repository.getLatestReport(actor, sessionId);
    if (!latest) throw new Error("NOT_FOUND");
    return latest;
  }
  const report = await repository.getReportVersion(actor, source.reportId, source.version);
  if (!report || report.positioningSessionId !== sessionId) throw new Error("NOT_FOUND");
  return report;
}

export async function getPositioningCandidate(
  actor: CurrentActor,
  reportId: string,
  version: number,
  candidateId: string,
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  const report = await repository.getReportVersion(actor, reportId, version);
  if (!report || report.status !== "ready") throw new Error("NOT_FOUND");
  const parsed = report.candidates
    .map((candidate) => positioningCandidateSchema.safeParse(candidate))
    .find((candidate) => candidate.success && candidate.data.id === candidateId);
  if (!parsed?.success) throw new Error("NOT_FOUND");
  return { report, candidate: parsed.data as PositioningCandidate };
}

export async function getConfirmedPositioningCandidate(
  actor: CurrentActor,
  reportId: string,
  version: number,
  candidateId: string,
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  const report = await repository.getReportVersion(actor, reportId, version);
  if (!report || report.status !== "ready" || report.generationMode !== "manual") {
    throw new Error("CONFIRMED_REPORT_NOT_FOUND");
  }
  const selected = positioningCandidateSchema.safeParse(report.selectedCandidate);
  if (!selected.success) throw new Error("CONFIRMED_CANDIDATE_INVALID");
  if (selected.data.id !== candidateId) throw new Error("CONFIRMED_CANDIDATE_MISMATCH");
  return { report, candidate: selected.data as PositioningCandidate };
}

export function getActiveCreatorProfile(
  actor: CurrentActor,
  repository: PositioningReadRepository = databasePositioningReadRepository,
) {
  return repository.getActiveProfile(actor);
}
