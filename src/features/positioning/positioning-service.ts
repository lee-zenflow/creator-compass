import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { AiFailure } from "@/server/ai/deepseek-client";
import { enqueueAiRun } from "@/server/ai/run-ai-task";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  creatorProfiles,
  creatorProfileVersions,
  aiRuns,
  interviewMessages,
  positioningReports,
  positioningSessions,
} from "@/server/db/schema";
import { assertReportAllowed } from "./profile-completeness";
import {
  positioningCandidateSchema,
  positioningReportOutputSchema,
  type PositioningCandidate,
} from "./positioning-schemas";

type SessionStatus = "draft" | "processing" | "ready" | "failed" | "archived";
type OwnedSession = {
  id: string;
  completeness: number;
  currentStep: number;
  draft: Record<string, unknown>;
  status: SessionStatus;
  updatedAt?: Date;
};
type StoredMessage = { id: string; sessionId: string; clientMessageId: string; message: string };
type StoredReportVersion = {
  id: string;
  reportId: string;
  version: number;
  generationMode: "manual" | "ai";
  status: SessionStatus;
  candidates: unknown[];
  selectedCandidate: Record<string, unknown> | null;
  positioningSessionId: string;
};

export interface PositioningRepository {
  transaction<T>(work: (repository: PositioningRepository) => Promise<T>): Promise<T>;
  findOwnedSession(actor: CurrentActor, sessionId: string): Promise<OwnedSession | null>;
  findUserMessageByClientId(sessionId: string, clientMessageId: string): Promise<StoredMessage | null>;
  findProcessingPositioningRun(
    actor: CurrentActor,
    sessionId: string,
  ): Promise<{ id: string; taskType: "profile_extract" | "positioning_report"; idempotencyKey: string } | null>;
  findPositioningRunByKey(
    actor: CurrentActor,
    sessionId: string,
    taskType: "profile_extract" | "positioning_report",
    idempotencyKey: string,
  ): Promise<{ id: string; status: SessionStatus } | null>;
  findOwnedPositioningRun(
    actor: CurrentActor,
    sessionId: string,
    aiRunId: string,
  ): Promise<{
    id: string;
    taskType: "profile_extract" | "positioning_report";
    status: SessionStatus;
  } | null>;
  insertUserMessage(
    actor: CurrentActor,
    input: { sessionId: string; clientMessageId: string; message: string },
  ): Promise<StoredMessage>;
  markSessionIdle(actor: CurrentActor, sessionId: string): Promise<void>;
  markSessionProcessing(actor: CurrentActor, sessionId: string): Promise<void>;
  findOwnedReportVersion(
    actor: CurrentActor,
    reportId: string,
    reportVersion: number,
  ): Promise<StoredReportVersion | null>;
  lockProfile(actor: CurrentActor): Promise<{ id: string; version: number } | null>;
  findConfirmation(
    actor: CurrentActor,
    reportId: string,
    reportVersion: number,
    candidateId: string,
  ): Promise<{ reportVersion: number; profileVersion: number } | null>;
  appendManualConfirmation(
    actor: CurrentActor,
    input: {
      report: StoredReportVersion;
      candidate: PositioningCandidate;
      parentVersion: number;
      expectedProfileVersion: number;
    },
  ): Promise<{ reportVersion: number; profileVersion: number }>;
}

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

function createDatabasePositioningRepository(database: CreatorCompassDatabase): PositioningRepository {
  return {
    transaction(work) {
      return database.transaction((transaction) =>
        work(createDatabasePositioningRepository(transaction as unknown as CreatorCompassDatabase)),
      );
    },
    async findOwnedSession(actor, sessionId) {
      const [row] = await database
        .select({
          id: positioningSessions.id,
          completeness: positioningSessions.completeness,
          currentStep: positioningSessions.currentStep,
          draft: positioningSessions.draft,
          status: positioningSessions.status,
          updatedAt: positioningSessions.updatedAt,
        })
        .from(positioningSessions)
        .where(and(eq(positioningSessions.id, sessionId), actorWhere(actor, positioningSessions)))
        .limit(1)
        .for("update");
      return row ?? null;
    },
    async findUserMessageByClientId(sessionId, clientMessageId) {
      const [row] = await database
        .select({ id: interviewMessages.id, sessionId: interviewMessages.positioningSessionId, clientMessageId: interviewMessages.clientMessageId, message: interviewMessages.content })
        .from(interviewMessages)
        .where(and(
          eq(interviewMessages.positioningSessionId, sessionId),
          eq(interviewMessages.sender, "user"),
          eq(interviewMessages.clientMessageId, clientMessageId),
        ))
        .limit(1);
      if (!row?.clientMessageId) return null;
      return { ...row, clientMessageId: row.clientMessageId };
    },
    async findProcessingPositioningRun(actor, sessionId) {
      const [row] = await database
        .select({ id: aiRuns.id, taskType: aiRuns.taskType, idempotencyKey: aiRuns.idempotencyKey })
        .from(aiRuns)
        .where(and(
          eq(aiRuns.positioningSessionId, sessionId),
          eq(aiRuns.status, "processing"),
          actorWhere(actor, aiRuns),
        ))
        .limit(1);
      if (!row || (row.taskType !== "profile_extract" && row.taskType !== "positioning_report")) return null;
      return { ...row, taskType: row.taskType };
    },
    async findPositioningRunByKey(actor, sessionId, taskType, idempotencyKey) {
      const [row] = await database
        .select({ id: aiRuns.id, status: aiRuns.status })
        .from(aiRuns)
        .where(and(
          eq(aiRuns.positioningSessionId, sessionId),
          eq(aiRuns.taskType, taskType),
          eq(aiRuns.idempotencyKey, idempotencyKey),
          actorWhere(actor, aiRuns),
        ))
        .limit(1);
      return row ?? null;
    },
    async findOwnedPositioningRun(actor, sessionId, aiRunId) {
      const [row] = await database
        .select({ id: aiRuns.id, taskType: aiRuns.taskType, status: aiRuns.status })
        .from(aiRuns)
        .where(and(
          eq(aiRuns.id, aiRunId),
          eq(aiRuns.positioningSessionId, sessionId),
          actorWhere(actor, aiRuns),
        ))
        .limit(1);
      if (!row || (row.taskType !== "profile_extract" && row.taskType !== "positioning_report")) {
        return null;
      }
      return { ...row, taskType: row.taskType };
    },
    async insertUserMessage(_actor, input) {
      const [row] = await database
        .insert(interviewMessages)
        .values({
          positioningSessionId: input.sessionId,
          sender: "user",
          clientMessageId: input.clientMessageId,
          content: input.message,
        })
        .returning({ id: interviewMessages.id });
      if (!row) throw new Error("MESSAGE_CREATE_FAILED");
      await database
        .update(positioningSessions)
        .set({ status: "processing", currentStep: sql`least(${positioningSessions.currentStep} + 1, 10)`, updatedAt: new Date() })
        .where(eq(positioningSessions.id, input.sessionId));
      return { id: row.id, ...input };
    },
    async markSessionIdle(actor, sessionId) {
      await database
        .update(positioningSessions)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(eq(positioningSessions.id, sessionId), actorWhere(actor, positioningSessions)));
    },
    async markSessionProcessing(actor, sessionId) {
      const rows = await database
        .update(positioningSessions)
        .set({ status: "processing", updatedAt: new Date() })
        .where(and(eq(positioningSessions.id, sessionId), actorWhere(actor, positioningSessions), eq(positioningSessions.status, "draft")))
        .returning({ id: positioningSessions.id });
      if (rows.length !== 1) throw new Error("AI_PROCESSING");
    },
    async findOwnedReportVersion(actor, reportId, reportVersion) {
      const [row] = await database
        .select({
          id: positioningReports.id,
          reportId: positioningReports.reportId,
          version: positioningReports.version,
          generationMode: positioningReports.generationMode,
          status: positioningReports.status,
          positioningSessionId: positioningReports.positioningSessionId,
          candidates: positioningReports.candidates,
          selectedCandidate: positioningReports.selectedCandidate,
        })
        .from(positioningReports)
        .where(and(
          eq(positioningReports.reportId, reportId),
          eq(positioningReports.version, reportVersion),
          actorWhere(actor, positioningReports),
        ))
        .limit(1)
        .for("update");
      return row ?? null;
    },
    async lockProfile(actor) {
      const [row] = await database
        .select({ id: creatorProfiles.id, version: creatorProfiles.version })
        .from(creatorProfiles)
        .where(actorWhere(actor, creatorProfiles))
        .limit(1)
        .for("update");
      return row ?? null;
    },
    async findConfirmation(actor, reportId, reportVersion, candidateId) {
      const rows = await database
        .select({ version: positioningReports.version, selectedCandidate: positioningReports.selectedCandidate })
        .from(positioningReports)
        .where(and(
          eq(positioningReports.reportId, reportId),
          eq(positioningReports.parentVersion, reportVersion),
          eq(positioningReports.generationMode, "manual"),
          actorWhere(actor, positioningReports),
        ))
        .orderBy(desc(positioningReports.version));
      const match = rows.find((row) => row.selectedCandidate?.id === candidateId);
      if (!match) return null;
      const [profileVersion] = await database
        .select({ version: creatorProfileVersions.version })
        .from(creatorProfileVersions)
        .where(and(
          actorWhere(actor, creatorProfileVersions),
          eq(creatorProfileVersions.sourceReportId, reportId),
          eq(creatorProfileVersions.sourceReportVersion, match.version),
        ))
        .limit(1);
      if (!profileVersion) throw new Error("CONFIRMATION_PROFILE_VERSION_MISSING");
      return { reportVersion: match.version, profileVersion: profileVersion.version };
    },
    async appendManualConfirmation(actor, input) {
      const [aiReport] = await database
        .select({ positioningSessionId: positioningReports.positioningSessionId })
        .from(positioningReports)
        .where(and(eq(positioningReports.id, input.report.id), actorWhere(actor, positioningReports)))
        .limit(1);
      if (!aiReport) throw new Error("REPORT_NOT_FOUND");
      const now = new Date();
      const [latest] = await database
        .select({ version: positioningReports.version })
        .from(positioningReports)
        .where(and(eq(positioningReports.reportId, input.report.reportId), actorWhere(actor, positioningReports)))
        .orderBy(desc(positioningReports.version))
        .limit(1)
        .for("update");
      const nextReportVersion = (latest?.version ?? input.parentVersion) + 1;
      const [manual] = await database
        .insert(positioningReports)
        .values({
          ...ownerValues(actor),
          reportId: input.report.reportId,
          positioningSessionId: aiReport.positioningSessionId,
          candidates: input.report.candidates,
          selectedCandidate: input.candidate,
          evidence: input.candidate.citations,
          parentVersion: input.parentVersion,
          generationMode: "manual",
          confirmedAt: now,
          version: nextReportVersion,
          status: "ready",
        })
        .returning({ version: positioningReports.version });
      if (!manual) throw new Error("CONFIRMATION_CREATE_FAILED");

      const [session] = await database
        .select({ draft: positioningSessions.draft })
        .from(positioningSessions)
        .where(and(
          eq(positioningSessions.id, input.report.positioningSessionId),
          actorWhere(actor, positioningSessions),
        ))
        .limit(1);
      if (!session) throw new Error("POSITIONING_SESSION_NOT_FOUND");
      const profileDimensions = session.draft.profileDimensions;
      if (!profileDimensions || typeof profileDimensions !== "object") {
        throw new Error("PROFILE_DRAFT_MISSING");
      }
      const profileDimensionRecord = profileDimensions as Record<string, unknown>;
      const [existingProfile] = await database
        .select({
          id: creatorProfiles.id,
          version: creatorProfiles.version,
          profileDimensions: creatorProfiles.profileDimensions,
          platformPreferences: creatorProfiles.platformPreferences,
        })
        .from(creatorProfiles)
        .where(actorWhere(actor, creatorProfiles))
        .limit(1)
        .for("update");
      if ((existingProfile?.version ?? 0) !== input.expectedProfileVersion) {
        throw new Error("PROFILE_VERSION_CONFLICT");
      }
      const nextProfileVersion = input.expectedProfileVersion + 1;
      const profileValues = {
        profileDimensions: profileDimensionRecord,
        currentPositioning: input.candidate.name,
        targetAudience: input.candidate.audience,
        contentDirection: input.candidate.direction,
        platformPreferences: existingProfile?.platformPreferences ?? [],
        version: nextProfileVersion,
        updatedAt: now,
      };
      let profileId = existingProfile?.id;
      if (profileId) {
        await database.update(creatorProfiles).set(profileValues).where(eq(creatorProfiles.id, profileId));
      } else {
        const [created] = await database
          .insert(creatorProfiles)
          .values({ ...ownerValues(actor), ...profileValues })
          .returning({ id: creatorProfiles.id });
        profileId = created?.id;
      }
      if (!profileId) throw new Error("PROFILE_CREATE_FAILED");
      const snapshot = {
        ...profileValues,
        selectedCandidateId: input.candidate.id,
        contentPillars: input.candidate.contentPillars,
        risks: input.candidate.risks,
      };
      await database.insert(creatorProfileVersions).values({
        ...ownerValues(actor),
        creatorProfileId: profileId,
        version: nextProfileVersion,
        parentVersion: input.expectedProfileVersion || null,
        sourceReportId: input.report.reportId,
        sourceReportVersion: manual.version,
        source: "manual",
        snapshot,
      });
      return { reportVersion: manual.version, profileVersion: nextProfileVersion };
    },
  };
}

export const databasePositioningRepository = createDatabasePositioningRepository(db);

const sendMessageInput = z.object({
  sessionId: z.uuid(),
  clientMessageId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(4_000),
}).strict();
const reportInput = z.object({ sessionId: z.uuid(), idempotencyKey: z.string().trim().min(1).max(128) }).strict();
const retryInput = z.object({
  sessionId: z.uuid(),
  failedRunId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();
const confirmationInput = z.object({
  reportId: z.uuid(),
  reportVersion: z.number().int().positive(),
  candidateId: z.string().trim().min(1).max(120),
  expectedProfileVersion: z.number().int().min(0),
}).strict();

type Enqueue = typeof enqueueAiRun;

async function markSessionIdleWhenNoRunIsActive(
  repository: PositioningRepository,
  actor: CurrentActor,
  sessionId: string,
) {
  try {
    const active = await repository.findProcessingPositioningRun(actor, sessionId);
    if (!active) await repository.markSessionIdle(actor, sessionId);
  } catch {
    // Keep the conservative processing state when the ownership-safe check is unavailable.
  }
}

export async function sendInterviewMessage(
  actor: CurrentActor,
  input: z.input<typeof sendMessageInput>,
  dependencies: { repository: PositioningRepository; enqueue: Enqueue } = {
    repository: databasePositioningRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = sendMessageInput.parse(input);
  const message = await dependencies.repository.transaction(async (repository) => {
    const session = await repository.findOwnedSession(actor, parsed.sessionId);
    if (!session) throw new Error("NOT_FOUND");
    const existing = await repository.findUserMessageByClientId(parsed.sessionId, parsed.clientMessageId);
    if (existing) {
      if (existing.message !== parsed.message) throw new Error("IDEMPOTENCY_KEY_REUSED");
      return { ...existing, existing: true as const };
    }
    if (session.status === "processing") {
      const active = await repository.findProcessingPositioningRun(actor, parsed.sessionId);
      if (active) throw new Error("AI_PROCESSING");
      const staleBefore = Date.now() - 2 * 60_000;
      if (!session.updatedAt || session.updatedAt.getTime() > staleBefore) {
        throw new Error("AI_PROCESSING");
      }
      await repository.markSessionIdle(actor, parsed.sessionId);
    }
    const inserted = await repository.insertUserMessage(actor, parsed);
    return { ...inserted, existing: false as const };
  });
  const runKey = `message:${parsed.clientMessageId}`;
  const priorRun = await dependencies.repository.findPositioningRunByKey(
    actor,
    parsed.sessionId,
    "profile_extract",
    runKey,
  );
  if (priorRun) {
    return { messageId: message.id, aiRunId: priorRun.id, aiStatus: priorRun.status };
  }
  const active = await dependencies.repository.findProcessingPositioningRun(actor, parsed.sessionId);
  if (active) {
    if (active.taskType !== "profile_extract" || active.idempotencyKey !== runKey) {
      throw new Error("AI_PROCESSING");
    }
    return { messageId: message.id, aiRunId: active.id, aiStatus: "processing" as const };
  }
  try {
    const run = await dependencies.enqueue(actor, {
      taskType: "profile_extract",
      entityId: parsed.sessionId,
      idempotencyKey: runKey,
    });
    return { messageId: message.id, aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    await markSessionIdleWhenNoRunIsActive(dependencies.repository, actor, parsed.sessionId);
    if (error instanceof AiFailure && error.code === "NOT_CONFIGURED") {
      return { messageId: message.id, aiRunId: null, aiStatus: "not_configured" as const };
    }
    throw error;
  }
}

export async function requestPositioningReport(
  actor: CurrentActor,
  input: z.input<typeof reportInput>,
  dependencies: { repository: PositioningRepository; enqueue: Enqueue } = {
    repository: databasePositioningRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = reportInput.parse(input);
  const session = await dependencies.repository.transaction(async (repository) => {
    const session = await repository.findOwnedSession(actor, parsed.sessionId);
    if (!session) throw new Error("NOT_FOUND");
    assertReportAllowed(session.completeness);
    if (session.status !== "processing") {
      await repository.markSessionProcessing(actor, parsed.sessionId);
    }
    return session;
  });
  if (session.status === "processing") {
    const priorRun = await dependencies.repository.findPositioningRunByKey(
      actor,
      parsed.sessionId,
      "positioning_report",
      parsed.idempotencyKey,
    );
    if (priorRun) return { aiRunId: priorRun.id, aiStatus: priorRun.status };
    const active = await dependencies.repository.findProcessingPositioningRun(actor, parsed.sessionId);
    if (active) {
      if (active.taskType !== "positioning_report" || active.idempotencyKey !== parsed.idempotencyKey) {
        throw new Error("AI_PROCESSING");
      }
      return { aiRunId: active.id, aiStatus: "processing" as const };
    }
  }
  try {
    const run = await dependencies.enqueue(actor, {
      taskType: "positioning_report",
      entityId: parsed.sessionId,
      idempotencyKey: parsed.idempotencyKey,
    });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    await markSessionIdleWhenNoRunIsActive(dependencies.repository, actor, parsed.sessionId);
    if (error instanceof AiFailure && error.code === "NOT_CONFIGURED") {
      return { aiRunId: null, aiStatus: "not_configured" as const };
    }
    throw error;
  }
}

export async function retryPositioningRun(
  actor: CurrentActor,
  input: z.input<typeof retryInput>,
  dependencies: { repository: PositioningRepository; enqueue: Enqueue } = {
    repository: databasePositioningRepository,
    enqueue: enqueueAiRun,
  },
) {
  const parsed = retryInput.parse(input);
  const failedRun = await dependencies.repository.transaction(async (repository) => {
    const session = await repository.findOwnedSession(actor, parsed.sessionId);
    if (!session) throw new Error("NOT_FOUND");
    const run = await repository.findOwnedPositioningRun(
      actor,
      parsed.sessionId,
      parsed.failedRunId,
    );
    if (!run || run.status !== "failed") throw new Error("AI_RUN_NOT_RETRYABLE");
    if (await repository.findProcessingPositioningRun(actor, parsed.sessionId)) {
      throw new Error("AI_PROCESSING");
    }
    await repository.markSessionProcessing(actor, parsed.sessionId);
    return run;
  });
  try {
    const run = await dependencies.enqueue(actor, {
      taskType: failedRun.taskType,
      entityId: parsed.sessionId,
      idempotencyKey: parsed.idempotencyKey,
    });
    return { aiRunId: run.aiRunId, aiStatus: "processing" as const };
  } catch (error) {
    await markSessionIdleWhenNoRunIsActive(dependencies.repository, actor, parsed.sessionId);
    if (error instanceof AiFailure && error.code === "NOT_CONFIGURED") {
      return { aiRunId: null, aiStatus: "not_configured" as const };
    }
    throw error;
  }
}

export async function confirmPositioningCandidate(
  actor: CurrentActor,
  input: z.input<typeof confirmationInput>,
  dependencies: { repository: PositioningRepository } = { repository: databasePositioningRepository },
) {
  const parsed = confirmationInput.parse(input);
  return dependencies.repository.transaction(async (repository) => {
    const report = await repository.findOwnedReportVersion(actor, parsed.reportId, parsed.reportVersion);
    if (!report || report.status !== "ready" || report.generationMode !== "ai") throw new Error("REPORT_NOT_READY");
    const existing = await repository.findConfirmation(actor, parsed.reportId, parsed.reportVersion, parsed.candidateId);
    if (existing) {
      return {
        ...existing,
        taskPreviewSource: { reportId: parsed.reportId, reportVersion: existing.reportVersion, candidateId: parsed.candidateId },
      };
    }
    const validated = positioningReportOutputSchema.parse({ candidates: report.candidates });
    const candidate = positioningCandidateSchema.parse(
      validated.candidates.find((item) => item.id === parsed.candidateId),
    );
    const profile = await repository.lockProfile(actor);
    if ((profile?.version ?? 0) !== parsed.expectedProfileVersion) throw new Error("PROFILE_VERSION_CONFLICT");
    const result = await repository.appendManualConfirmation(actor, {
      report,
      candidate,
      parentVersion: parsed.reportVersion,
      expectedProfileVersion: parsed.expectedProfileVersion,
    });
    return {
      ...result,
      taskPreviewSource: { reportId: parsed.reportId, reportVersion: result.reportVersion, candidateId: parsed.candidateId },
    };
  });
}
