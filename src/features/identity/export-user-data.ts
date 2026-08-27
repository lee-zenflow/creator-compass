import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { CurrentActor } from "./current-actor";
import { db } from "@/server/db/client";
import { creatorProfiles, creationProjects, materials, positioningSessions, reports, reviews, tasks, userSettings } from "@/server/db/schema";

export const USER_EXPORT_GROUPS = ["profile", "positioning", "creation", "materials", "reviews", "tasks", "reports", "settings"] as const;
type ExportGroup = (typeof USER_EXPORT_GROUPS)[number];

export interface UserExportRepository { readGroup(actor: CurrentActor, group: ExportGroup): Promise<unknown[]>; }
function actorWhere(actor: CurrentActor, table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn }) {
  return actor.kind === "user" ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId)) : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

export const databaseUserExportRepository: UserExportRepository = {
  async readGroup(actor, group) {
    if (group === "profile") return db.select({ profileDimensions: creatorProfiles.profileDimensions, currentPositioning: creatorProfiles.currentPositioning, targetAudience: creatorProfiles.targetAudience, contentDirection: creatorProfiles.contentDirection, platformPreferences: creatorProfiles.platformPreferences, version: creatorProfiles.version, updatedAt: creatorProfiles.updatedAt }).from(creatorProfiles).where(actorWhere(actor, creatorProfiles));
    if (group === "positioning") return db.select({ id: positioningSessions.id, status: positioningSessions.status, completeness: positioningSessions.completeness, createdAt: positioningSessions.createdAt, updatedAt: positioningSessions.updatedAt }).from(positioningSessions).where(actorWhere(actor, positioningSessions));
    if (group === "creation") return db.select({ id: creationProjects.id, contentType: creationProjects.contentType, platform: creationProjects.platform, goal: creationProjects.goal, requirements: creationProjects.requirements, status: creationProjects.status, createdAt: creationProjects.createdAt }).from(creationProjects).where(actorWhere(actor, creationProjects));
    if (group === "materials") return db.select({ id: materials.id, name: materials.name, type: materials.type, category: materials.category, source: materials.source, summary: materials.summary, body: materials.body, tags: materials.tags, createdAt: materials.createdAt }).from(materials).where(actorWhere(actor, materials));
    if (group === "reviews") return db.select({ id: reviews.id, platform: reviews.platform, platformAccountId: reviews.platformAccountId, contentTitle: reviews.contentTitle, publishedAt: reviews.publishedAt, collectedAt: reviews.collectedAt, status: reviews.status, sourceMode: reviews.sourceMode }).from(reviews).where(actorWhere(actor, reviews));
    if (group === "tasks") return db.select({ id: tasks.id, title: tasks.title, reason: tasks.reason, steps: tasks.steps, plannedDate: tasks.plannedDate, completionCriteria: tasks.completionCriteria, priority: tasks.priority, status: tasks.status, completedAt: tasks.completedAt }).from(tasks).where(actorWhere(actor, tasks));
    if (group === "reports") return db.select({ id: reports.id, type: reports.type, title: reports.title, summary: reports.summary, status: reports.status, createdAt: reports.createdAt }).from(reports).where(actorWhere(actor, reports));
    return db.select({ emailReminders: userSettings.emailReminders, productUpdates: userSettings.productUpdates, privacy: userSettings.privacy, preferences: userSettings.preferences, updatedAt: userSettings.updatedAt }).from(userSettings).where(actorWhere(actor, userSettings));
  },
};

export async function exportUserData(actor: CurrentActor, repository: UserExportRepository = databaseUserExportRepository): Promise<ReadableStream<Uint8Array>> {
  const entries = await Promise.all(USER_EXPORT_GROUPS.map(async (group) => [group, await repository.readGroup(actor, group)] as const));
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), ...Object.fromEntries(entries) }, null, 2);
  const bytes = new TextEncoder().encode(payload);
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}
