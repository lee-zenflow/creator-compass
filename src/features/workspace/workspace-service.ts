import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { calculateReviewMetrics, type ConfirmedMetrics } from "@/features/reviews/calculate-metrics";
import { db } from "@/server/db/client";
import {
  aiRuns,
  contentPlans,
  creationProjects,
  creatorProfiles,
  metricSnapshots,
  platformAccounts,
  positioningReports,
  positioningSessions,
  reports,
  reviewReports,
  reviews,
  tasks,
} from "@/server/db/schema";

import {
  resolveNextAction,
  type NextAction,
  type NextActionFacts,
  type NextActionTaskType,
} from "./next-action-service";

type Account = { id: string; platform: string; accountLabel: string | null; dataSource: string; isActive: boolean };
type MetricPoint = { reviewId?: string; capturedAt: Date; confirmedMetrics: Record<string, number | string | null>; calculatedMetrics: Record<string, number | null> };
type WorkspaceTask = { id: string; title: string; plannedDate: string; status: "pending" | "in_progress" | "completed" | "dismissed" };
type RecentReport = { id: string; type: "positioning" | "creation" | "review"; title: string; summary: string | null; createdAt: Date };

export const workspaceRangeSchema = z.union([z.literal(3), z.literal(7), z.literal(30)]);
export type WorkspaceRange = z.infer<typeof workspaceRangeSchema>;
export type WorkspaceMetrics = { views: number | null; interactionRate: number | null; followerConversionRate: number | null };

export interface WorkspaceRepository {
  listAccounts(actor: CurrentActor): Promise<Account[]>;
  listMetricPoints(actor: CurrentActor, platformAccountId: string, since: Date): Promise<MetricPoint[]>;
  findLatestInsight(actor: CurrentActor, platformAccountId: string): Promise<{ reportId: string; reviewId: string; version: number; problem: string | null; action: string | null } | null>;
  listTasks(actor: CurrentActor): Promise<WorkspaceTask[]>;
  listRecentReports(actor: CurrentActor): Promise<RecentReport[]>;
  getJourneyFacts(actor: CurrentActor): Promise<NextActionFacts>;
}

function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function firstString(input: unknown) {
  const parsed = z.array(z.unknown()).safeParse(input);
  return parsed.success && typeof parsed.data[0] === "string" ? parsed.data[0] : null;
}
function firstActionTitle(input: unknown) {
  const parsed = z.array(z.object({ title: z.string() }).passthrough()).safeParse(input);
  return parsed.success ? parsed.data[0]?.title ?? null : null;
}

function selectedCandidateId(input: unknown) {
  const parsed = z.object({ id: z.string().min(1) }).passthrough().safeParse(input);
  return parsed.success ? parsed.data.id : null;
}

function aiRunHref(run: {
  taskType: NextActionTaskType;
  positioningSessionId: string | null;
  creationProjectId: string | null;
  reviewId: string | null;
}) {
  if (run.taskType === "content_plan" && run.creationProjectId) {
    return `/creation/${run.creationProjectId}/plan`;
  }
  if (run.taskType === "review_report" && run.reviewId) {
    return `/reviews/${run.reviewId}/report`;
  }
  if (run.positioningSessionId) return `/positioning/${run.positioningSessionId}`;
  return null;
}

export const databaseWorkspaceRepository: WorkspaceRepository = {
  async listAccounts(actor) {
    return db.select({ id: platformAccounts.id, platform: platformAccounts.platform, accountLabel: platformAccounts.accountLabel, dataSource: platformAccounts.dataSource, isActive: platformAccounts.isActive })
      .from(platformAccounts).where(actorWhere(actor, platformAccounts))
      .orderBy(desc(platformAccounts.isActive), desc(platformAccounts.updatedAt));
  },
  async listMetricPoints(actor, platformAccountId, since) {
    return db.select({ reviewId: metricSnapshots.reviewId, capturedAt: metricSnapshots.capturedAt, confirmedMetrics: metricSnapshots.confirmedMetrics, calculatedMetrics: metricSnapshots.calculatedMetrics })
      .from(metricSnapshots).innerJoin(reviews, eq(metricSnapshots.reviewId, reviews.id))
      .where(and(
        actorWhere(actor, reviews),
        eq(reviews.platformAccountId, platformAccountId),
        isNotNull(metricSnapshots.userConfirmedAt),
        gte(metricSnapshots.capturedAt, since),
      ))
      .orderBy(metricSnapshots.capturedAt);
  },
  async findLatestInsight(actor, platformAccountId) {
    const [row] = await db.select({
      reportId: reviewReports.reportId, reviewId: reviewReports.reviewId, version: reviewReports.version,
      problems: reviewReports.problems, recommendations: reviewReports.recommendations,
    }).from(reviewReports).innerJoin(reviews, eq(reviewReports.reviewId, reviews.id))
      .where(and(actorWhere(actor, reviewReports), eq(reviews.platformAccountId, platformAccountId), eq(reviewReports.status, "ready")))
      .orderBy(desc(reviewReports.createdAt), desc(reviewReports.version)).limit(1);
    return row ? { reportId: row.reportId, reviewId: row.reviewId, version: row.version, problem: firstString(row.problems), action: firstActionTitle(row.recommendations) } : null;
  },
  async listTasks(actor) {
    return db.select({ id: tasks.id, title: tasks.title, plannedDate: tasks.plannedDate, status: tasks.status })
      .from(tasks).where(and(actorWhere(actor, tasks), inArray(tasks.status, ["pending", "in_progress"])))
      .orderBy(tasks.plannedDate, tasks.sortOrder);
  },
  async listRecentReports(actor) {
    return db.select({ id: reports.id, type: reports.type, title: reports.title, summary: reports.summary, createdAt: reports.createdAt })
      .from(reports).where(actorWhere(actor, reports)).orderBy(desc(reports.createdAt)).limit(3);
  },
  async getJourneyFacts(actor) {
    const [profileRows, sessionRows, runRows, positioningRows, projectRows, planRows, reviewRows, taskRows] = await Promise.all([
      db.select({ id: creatorProfiles.id }).from(creatorProfiles)
        .where(actorWhere(actor, creatorProfiles)).limit(1),
      db.select({ id: positioningSessions.id, status: positioningSessions.status })
        .from(positioningSessions).where(actorWhere(actor, positioningSessions))
        .orderBy(desc(positioningSessions.updatedAt), desc(positioningSessions.id)).limit(1),
      db.select({
        taskType: aiRuns.taskType,
        status: aiRuns.status,
        positioningSessionId: aiRuns.positioningSessionId,
        creationProjectId: aiRuns.creationProjectId,
        reviewId: aiRuns.reviewId,
      }).from(aiRuns)
        .where(and(actorWhere(actor, aiRuns), inArray(aiRuns.status, ["processing", "failed"])))
        .orderBy(desc(aiRuns.updatedAt), desc(aiRuns.createdAt)).limit(1),
      db.select({
        reportId: positioningReports.reportId,
        positioningSessionId: positioningReports.positioningSessionId,
        selectedCandidate: positioningReports.selectedCandidate,
        confirmedAt: positioningReports.confirmedAt,
        version: positioningReports.version,
        status: positioningReports.status,
        createdAt: positioningReports.createdAt,
      }).from(positioningReports).where(actorWhere(actor, positioningReports))
        .orderBy(desc(positioningReports.createdAt), desc(positioningReports.version)).limit(1),
      db.select({ id: creationProjects.id, status: creationProjects.status })
        .from(creationProjects).where(actorWhere(actor, creationProjects))
        .orderBy(desc(creationProjects.updatedAt), desc(creationProjects.id)).limit(1),
      db.select({
        reportId: contentPlans.reportId,
        creationProjectId: contentPlans.creationProjectId,
        version: contentPlans.version,
        status: contentPlans.status,
        createdAt: contentPlans.createdAt,
      }).from(contentPlans).where(actorWhere(actor, contentPlans))
        .orderBy(desc(contentPlans.createdAt), desc(contentPlans.version)).limit(1),
      db.select({
        reportId: reviewReports.reportId,
        reviewId: reviewReports.reviewId,
        version: reviewReports.version,
        status: reviewReports.status,
        createdAt: reviewReports.createdAt,
      }).from(reviewReports).where(actorWhere(actor, reviewReports))
        .orderBy(desc(reviewReports.createdAt), desc(reviewReports.version)).limit(1),
      db.select({ id: tasks.id, title: tasks.title })
        .from(tasks).where(and(actorWhere(actor, tasks), inArray(tasks.status, ["pending", "in_progress"])))
        .orderBy(asc(tasks.priority), asc(tasks.plannedDate), asc(tasks.createdAt)).limit(1),
    ]);

    const session = sessionRows[0] ?? null;
    const run = runRows[0] ?? null;
    const positioning = positioningRows[0] ?? null;
    const project = projectRows[0] ?? null;
    const plan = planRows[0] ?? null;
    const review = reviewRows[0] ?? null;
    const runHref = run ? aiRunHref(run) : null;
    const candidateId = selectedCandidateId(positioning?.selectedCandidate);

    const taskSources = [
      ...(positioning && positioning.status === "ready" && candidateId
        ? [{
            createdAt: positioning.createdAt,
            reportId: positioning.reportId,
            version: positioning.version,
            href: `/positioning/${positioning.positioningSessionId}/tasks?report=${positioning.reportId}&version=${positioning.version}&candidate=${candidateId}`,
            source: { type: "positioning" as const, id: positioning.reportId, version: positioning.version },
          }]
        : []),
      ...(plan && plan.status === "ready"
        ? [{
            createdAt: plan.createdAt,
            reportId: plan.reportId,
            version: plan.version,
            href: `/creation/${plan.creationProjectId}/tasks?report=${plan.reportId}&version=${plan.version}`,
            source: { type: "creation" as const, id: plan.reportId, version: plan.version },
          }]
        : []),
      ...(review && review.status === "ready"
        ? [{
            createdAt: review.createdAt,
            reportId: review.reportId,
            version: review.version,
            href: `/reviews/${review.reviewId}/tasks?report=${review.reportId}&version=${review.version}`,
            source: { type: "review" as const, id: review.reportId, version: review.version },
          }]
        : []),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    let unsavedTaskSource: NextActionFacts["unsavedTaskSource"] = null;
    for (const source of taskSources) {
      const existing = await db.select({ id: tasks.id }).from(tasks).where(and(
        actorWhere(actor, tasks),
        eq(tasks.sourceReportId, source.reportId),
        eq(tasks.sourceVersion, source.version),
      )).limit(1);
      if (existing.length === 0) {
        unsavedTaskSource = { href: source.href, source: source.source };
        break;
      }
    }

    const runAction = run && runHref
      ? { taskType: run.taskType, href: runHref }
      : null;
    const positioningReady = positioning?.status === "ready";
    return {
      hasProfile: profileRows.length > 0,
      hasPositioning: Boolean(session),
      interview: session && !positioningReady
        ? { href: `/positioning/${session.id}`, status: session.status === "processing" ? "processing" : "incomplete" }
        : null,
      processingRun: run?.status === "processing" ? runAction : null,
      failedRun: run?.status === "failed" ? runAction : null,
      unconfirmedPositioning: positioningReady && !candidateId
        ? { href: `/positioning/${positioning!.positioningSessionId}/report` }
        : null,
      confirmedPositioning: positioning?.confirmedAt && candidateId
        ? { reportId: positioning.reportId, version: positioning.version }
        : null,
      creationProject: project ? { id: project.id } : null,
      unsavedTaskSource,
      highestPriorityTask: taskRows[0] ?? null,
      publishedWithoutReview: null,
      reviewActionTask: null,
    };
  },
};

type NewUserWorkspaceView = { kind: "newUser"; range: WorkspaceRange; accounts: Account[]; nextAction: NextAction };
type ActiveWorkspaceView = {
      kind: "activeUser"; range: WorkspaceRange; accounts: Account[]; activeAccount: Account;
      metrics: WorkspaceMetrics | null;
      historicalConclusion: string | null;
      dataRequirement: string | null;
      trend: Array<{ date: string; views: number | null }>;
      insight: Awaited<ReturnType<WorkspaceRepository["findLatestInsight"]>>;
      upcomingTasks: Array<WorkspaceTask & { completed: boolean; daysFromToday: number }>;
      recentReports: RecentReport[];
      nextAction: NextAction;
    };

export type WorkspaceEvidenceViewModel = NewUserWorkspaceView | ActiveWorkspaceView;
export type WorkspaceViewModel =
  | NewUserWorkspaceView
  | (Omit<ActiveWorkspaceView, "metrics"> & {
      metrics: WorkspaceMetrics;
    });

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function confirmedMetricsFrom(point: MetricPoint): ConfirmedMetrics {
  const output: ConfirmedMetrics = {};
  for (const key of ["views", "likes", "comments", "favorites", "shares", "followersGained"] as const) {
    const value = point.confirmedMetrics[key];
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

function latestPointPerReview(points: MetricPoint[]) {
  const latest = new Map<string, MetricPoint>();
  points.forEach((point, index) => {
    const key = point.reviewId ?? `snapshot:${index}`;
    const previous = latest.get(key);
    if (!previous || point.capturedAt > previous.capturedAt) latest.set(key, point);
  });
  return [...latest.values()].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
}

export async function getWorkspaceView(
  actor: CurrentActor,
  range: WorkspaceRange,
  repository: WorkspaceRepository = databaseWorkspaceRepository,
  now = new Date(),
): Promise<WorkspaceEvidenceViewModel> {
  const parsedRange = workspaceRangeSchema.parse(range);
  const [accounts, journeyFacts] = await Promise.all([
    repository.listAccounts(actor),
    repository.getJourneyFacts(actor),
  ]);
  const nextAction = resolveNextAction(journeyFacts);
  const activeAccount = accounts.find((account) => account.isActive) ?? accounts[0];
  if (!activeAccount) return { kind: "newUser", range: parsedRange, accounts, nextAction };
  const sinceDate = dateKey(new Date(now.getTime() - (parsedRange - 1) * 86_400_000));
  const since = new Date(`${sinceDate}T00:00:00+08:00`);
  const [points, insight, allTasks, recentReports] = await Promise.all([
    repository.listMetricPoints(actor, activeAccount.id, since),
    repository.findLatestInsight(actor, activeAccount.id),
    repository.listTasks(actor),
    repository.listRecentReports(actor),
  ]);
  const confirmedPoints = latestPointPerReview(points);
  const summary = calculateReviewMetrics(confirmedPoints.map(confirmedMetricsFrom));
  const today = dayNumber(dateKey(now));
  const upcomingTasks = allTasks.map((task) => ({
    ...task, completed: task.status === "completed", daysFromToday: dayNumber(task.plannedDate) - today,
  })).filter((task) => !task.completed && task.status !== "dismissed" && task.daysFromToday >= 0 && task.daysFromToday <= 3)
    .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate)).slice(0, 2);
  return {
    kind: "activeUser", range: parsedRange, accounts, activeAccount,
    metrics: summary.metrics,
    historicalConclusion: summary.historicalConclusion,
    dataRequirement: summary.dataRequirement,
    trend: confirmedPoints.map((point) => ({ date: dateKey(point.capturedAt), views: typeof point.confirmedMetrics.views === "number" ? point.confirmedMetrics.views : null })),
    insight, upcomingTasks, recentReports, nextAction,
  };
}

export async function getWorkspace(
  actor: CurrentActor,
  range: WorkspaceRange,
  repository: WorkspaceRepository = databaseWorkspaceRepository,
  now = new Date(),
): Promise<WorkspaceViewModel> {
  const view = await getWorkspaceView(actor, range, repository, now);
  if (view.kind === "newUser") return view;
  return {
    ...view,
    metrics: view.metrics ?? { views: null, interactionRate: null, followerConversionRate: null },
  };
}
