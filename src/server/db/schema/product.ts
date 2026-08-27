import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { guestSessions, users } from "./auth";

export const actorKind = pgEnum("actor_kind", ["guest", "user"]);
export const recordStatus = pgEnum("record_status", [
  "draft",
  "processing",
  "ready",
  "failed",
  "archived",
]);
export const taskStatus = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "dismissed",
]);
export const reportType = pgEnum("report_type", ["positioning", "creation", "review"]);
export const aiTaskType = pgEnum("ai_task_type", [
  "profile_extract",
  "positioning_report",
  "content_plan",
  "review_report",
]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected"]);
export const retrievalScope = pgEnum("retrieval_scope", ["production", "development_only"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system"]);
export const reviewSourceMode = pgEnum("review_source_mode", ["manual", "ocr"]);
export const generationMode = pgEnum("generation_mode", ["manual", "ai"]);
export const materialCategory = pgEnum("material_category", [
  "inspiration",
  "history_content",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

const actorColumns = {
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  guestSessionId: uuid("guest_session_id").references(() => guestSessions.id, {
    onDelete: "cascade",
  }),
};

function actorConstraints(
  tableName: string,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return [
    check(
      `${tableName}_exactly_one_actor`,
      sql`num_nonnulls(${table.userId}, ${table.guestSessionId}) = 1`,
    ),
    index(`${tableName}_user_owner_idx`).on(table.userId),
    index(`${tableName}_guest_owner_idx`).on(table.guestSessionId),
  ];
}

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    emailReminders: boolean("email_reminders").default(true).notNull(),
    productUpdates: boolean("product_updates").default(false).notNull(),
    privacy: jsonb("privacy").$type<Record<string, boolean>>().default({}).notNull(),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default({}).notNull(),
    mergeState: text("merge_state").default("clean").notNull(),
    sourceGuestSessionId: uuid("source_guest_session_id").references(() => guestSessions.id, {
      onDelete: "set null",
    }),
    guestDraft: jsonb("guest_draft").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("user_settings", table),
    uniqueIndex("user_settings_user_unique_idx")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("user_settings_guest_unique_idx")
      .on(table.guestSessionId)
      .where(sql`${table.guestSessionId} is not null`),
  ],
);

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    platform: text("platform").notNull(),
    accountLabel: text("account_label"),
    dataSource: text("data_source").default("manual").notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("platform_accounts", table),
    uniqueIndex("platform_accounts_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("platform_accounts_id_guest_unique_idx").on(table.id, table.guestSessionId),
    uniqueIndex("platform_accounts_active_user_idx")
      .on(table.userId).where(sql`${table.userId} is not null and ${table.isActive} = true`),
    uniqueIndex("platform_accounts_active_guest_idx")
      .on(table.guestSessionId).where(sql`${table.guestSessionId} is not null and ${table.isActive} = true`),
  ],
);

export const creatorProfiles = pgTable(
  "creator_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    profileDimensions: jsonb("profile_dimensions").$type<Record<string, unknown>>().default({}).notNull(),
    currentPositioning: text("current_positioning"),
    targetAudience: text("target_audience"),
    contentDirection: text("content_direction"),
    platformPreferences: jsonb("platform_preferences").$type<string[]>().default([]).notNull(),
    materialNotes: text("material_notes"),
    version: integer("version").default(1).notNull(),
    mergeState: text("merge_state").default("clean").notNull(),
    sourceGuestSessionId: uuid("source_guest_session_id").references(() => guestSessions.id, {
      onDelete: "set null",
    }),
    guestDraft: jsonb("guest_draft").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("creator_profiles", table),
    uniqueIndex("creator_profiles_user_unique_idx")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("creator_profiles_guest_unique_idx")
      .on(table.guestSessionId)
      .where(sql`${table.guestSessionId} is not null`),
    uniqueIndex("creator_profiles_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("creator_profiles_id_guest_unique_idx").on(table.id, table.guestSessionId),
  ],
);

export const creatorProfileVersions = pgTable(
  "creator_profile_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    creatorProfileId: uuid("creator_profile_id")
      .notNull()
      .references(() => creatorProfiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentVersion: integer("parent_version"),
    sourceReportId: uuid("source_report_id"),
    sourceReportVersion: integer("source_report_version"),
    source: generationMode("source").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("creator_profile_versions", table),
    uniqueIndex("creator_profile_versions_profile_version_idx").on(
      table.creatorProfileId,
      table.version,
    ),
    foreignKey({
      name: "creator_profile_versions_profile_user_owner_fk",
      columns: [table.creatorProfileId, table.userId],
      foreignColumns: [creatorProfiles.id, creatorProfiles.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "creator_profile_versions_profile_guest_owner_fk",
      columns: [table.creatorProfileId, table.guestSessionId],
      foreignColumns: [creatorProfiles.id, creatorProfiles.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "creator_profile_versions_parent_fk",
      columns: [table.creatorProfileId, table.parentVersion],
      foreignColumns: [table.creatorProfileId, table.version],
    }),
    foreignKey({
      name: "creator_profile_versions_source_report_user_owner_fk",
      columns: [table.sourceReportId, table.sourceReportVersion, table.userId],
      foreignColumns: [positioningReports.reportId, positioningReports.version, positioningReports.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creator_profile_versions_source_report_guest_owner_fk",
      columns: [table.sourceReportId, table.sourceReportVersion, table.guestSessionId],
      foreignColumns: [positioningReports.reportId, positioningReports.version, positioningReports.guestSessionId],
    }).onDelete("restrict"),
    check("creator_profile_versions_version_positive", sql`${table.version} > 0`),
    check(
      "creator_profile_versions_parent_before_child",
      sql`${table.parentVersion} is null or ${table.parentVersion} < ${table.version}`,
    ),
    check(
      "creator_profile_versions_source_pair",
      sql`(${table.sourceReportId} is null and ${table.sourceReportVersion} is null) or (${table.sourceReportId} is not null and ${table.sourceReportVersion} is not null)`,
    ),
  ],
);

export const positioningSessions = pgTable(
  "positioning_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    status: recordStatus("status").default("draft").notNull(),
    completeness: integer("completeness").default(0).notNull(),
    currentStep: integer("current_step").default(0).notNull(),
    draft: jsonb("draft").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("positioning_sessions", table),
    uniqueIndex("positioning_sessions_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("positioning_sessions_id_guest_unique_idx").on(table.id, table.guestSessionId),
    check("positioning_sessions_completeness_range", sql`${table.completeness} between 0 and 100`),
    check("positioning_sessions_current_step_range", sql`${table.currentStep} between 0 and 10`),
  ],
);

export const interviewMessages = pgTable(
  "interview_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    positioningSessionId: uuid("positioning_session_id")
      .notNull()
      .references(() => positioningSessions.id, { onDelete: "cascade" }),
    sender: messageRole("sender").notNull(),
    clientMessageId: text("client_message_id"),
    content: text("content").notNull(),
    extractedProfile: jsonb("extracted_profile").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("interview_messages_session_idx").on(table.positioningSessionId),
    uniqueIndex("interview_messages_session_client_unique_idx")
      .on(table.positioningSessionId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    check(
      "interview_messages_user_client_id_required",
      sql`${table.sender} <> 'user' or ${table.clientMessageId} is not null`,
    ),
  ],
);

export const positioningReports = pgTable(
  "positioning_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    positioningSessionId: uuid("positioning_session_id")
      .notNull()
      .references(() => positioningSessions.id, { onDelete: "cascade" }),
    candidates: jsonb("candidates").$type<unknown[]>().default([]).notNull(),
    selectedCandidate: jsonb("selected_candidate").$type<Record<string, unknown>>(),
    evidence: jsonb("evidence").$type<unknown[]>().default([]).notNull(),
    model: text("model"),
    schemaVersion: integer("schema_version").default(1).notNull(),
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id, {
      onDelete: "restrict",
    }),
    retrievalRecordId: uuid("retrieval_record_id").references(() => retrievalRecords.id, {
      onDelete: "restrict",
    }),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "restrict" }),
    parentVersion: integer("parent_version"),
    generationMode: generationMode("generation_mode").default("ai").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    status: recordStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("positioning_reports", table),
    index("positioning_reports_session_idx").on(table.positioningSessionId),
    uniqueIndex("positioning_reports_session_version_idx").on(
      table.positioningSessionId,
      table.version,
    ),
    uniqueIndex("positioning_reports_report_version_idx").on(table.reportId, table.version),
    uniqueIndex("positioning_reports_report_version_user_unique_idx").on(
      table.reportId,
      table.version,
      table.userId,
    ),
    uniqueIndex("positioning_reports_report_version_guest_unique_idx").on(
      table.reportId,
      table.version,
      table.guestSessionId,
    ),
    uniqueIndex("positioning_reports_ai_run_unique_idx")
      .on(table.aiRunId)
      .where(sql`${table.aiRunId} is not null`),
    foreignKey({
      name: "positioning_reports_report_user_owner_fk",
      columns: [table.reportId, table.userId],
      foreignColumns: [reports.id, reports.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "positioning_reports_report_guest_owner_fk",
      columns: [table.reportId, table.guestSessionId],
      foreignColumns: [reports.id, reports.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "positioning_reports_session_user_owner_fk",
      columns: [table.positioningSessionId, table.userId],
      foreignColumns: [positioningSessions.id, positioningSessions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "positioning_reports_session_guest_owner_fk",
      columns: [table.positioningSessionId, table.guestSessionId],
      foreignColumns: [positioningSessions.id, positioningSessions.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "positioning_reports_ai_run_user_owner_fk",
      columns: [table.aiRunId, table.userId],
      foreignColumns: [aiRuns.id, aiRuns.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "positioning_reports_ai_run_guest_owner_fk",
      columns: [table.aiRunId, table.guestSessionId],
      foreignColumns: [aiRuns.id, aiRuns.guestSessionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "positioning_reports_retrieval_user_owner_fk",
      columns: [table.retrievalRecordId, table.userId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "positioning_reports_retrieval_guest_owner_fk",
      columns: [table.retrievalRecordId, table.guestSessionId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.guestSessionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "positioning_reports_parent_fk",
      columns: [table.reportId, table.parentVersion],
      foreignColumns: [table.reportId, table.version],
    }),
    check(
      "positioning_reports_parent_before_child",
      sql`${table.parentVersion} is null or ${table.parentVersion} < ${table.version}`,
    ),
    check(
      "positioning_reports_provenance_required",
      sql`(${table.generationMode} = 'ai' and ${table.aiRunId} is not null and ${table.model} is not null and ${table.promptVersionId} is not null and ${table.retrievalRecordId} is not null) or (${table.generationMode} = 'manual' and ${table.parentVersion} is not null)`,
    ),
  ],
);

export const creationProjects = pgTable(
  "creation_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    contentType: text("content_type").notNull(),
    platform: text("platform").notNull(),
    goal: text("goal").notNull(),
    requirements: text("requirements"),
    availableMinutes: integer("available_minutes"),
    status: recordStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("creation_projects", table),
    uniqueIndex("creation_projects_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("creation_projects_id_guest_unique_idx").on(table.id, table.guestSessionId),
  ],
);

export const contentPlans = pgTable(
  "content_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    creationProjectId: uuid("creation_project_id")
      .notNull()
      .references(() => creationProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    outline: jsonb("outline").$type<unknown[]>().default([]).notNull(),
    body: text("body").notNull(),
    contentPayload: jsonb("content_payload").$type<Record<string, unknown>>().default({}).notNull(),
    mediaSuggestions: jsonb("media_suggestions").$type<unknown[]>().default([]).notNull(),
    platformSuggestions: jsonb("platform_suggestions").$type<unknown[]>().default([]).notNull(),
    citations: jsonb("citations").$type<unknown[]>().default([]).notNull(),
    sourceSnapshot: jsonb("source_snapshot").$type<{
      profileVersion: number | null;
      materialIds: string[];
    }>().default({ profileVersion: null, materialIds: [] }).notNull(),
    model: text("model"),
    schemaVersion: integer("schema_version").default(1).notNull(),
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id, {
      onDelete: "restrict",
    }),
    retrievalRecordId: uuid("retrieval_record_id").references(() => retrievalRecords.id, {
      onDelete: "restrict",
    }),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "restrict" }),
    parentVersion: integer("parent_version"),
    generationMode: generationMode("generation_mode").default("ai").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    status: recordStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("content_plans", table),
    index("content_plans_project_idx").on(table.creationProjectId),
    uniqueIndex("content_plans_project_version_idx").on(table.creationProjectId, table.version),
    uniqueIndex("content_plans_report_version_idx").on(table.reportId, table.version),
    uniqueIndex("content_plans_ai_run_unique_idx")
      .on(table.aiRunId)
      .where(sql`${table.aiRunId} is not null`),
    foreignKey({
      name: "content_plans_parent_version_fk",
      columns: [table.reportId, table.parentVersion],
      foreignColumns: [table.reportId, table.version],
    }).onDelete("restrict"),
    foreignKey({
      name: "content_plans_report_user_owner_fk",
      columns: [table.reportId, table.userId],
      foreignColumns: [reports.id, reports.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "content_plans_report_guest_owner_fk",
      columns: [table.reportId, table.guestSessionId],
      foreignColumns: [reports.id, reports.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "content_plans_project_user_owner_fk",
      columns: [table.creationProjectId, table.userId],
      foreignColumns: [creationProjects.id, creationProjects.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "content_plans_project_guest_owner_fk",
      columns: [table.creationProjectId, table.guestSessionId],
      foreignColumns: [creationProjects.id, creationProjects.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "content_plans_ai_run_user_owner_fk",
      columns: [table.aiRunId, table.userId],
      foreignColumns: [aiRuns.id, aiRuns.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "content_plans_ai_run_guest_owner_fk",
      columns: [table.aiRunId, table.guestSessionId],
      foreignColumns: [aiRuns.id, aiRuns.guestSessionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "content_plans_retrieval_user_owner_fk",
      columns: [table.retrievalRecordId, table.userId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "content_plans_retrieval_guest_owner_fk",
      columns: [table.retrievalRecordId, table.guestSessionId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.guestSessionId],
    }).onDelete("restrict"),
    check(
      "content_plans_parent_before_child",
      sql`${table.parentVersion} is null or ${table.parentVersion} < ${table.version}`,
    ),
    check(
      "content_plans_provenance_required",
      sql`(${table.generationMode} = 'ai' and ${table.aiRunId} is not null and ${table.model} is not null and ${table.promptVersionId} is not null and ${table.retrievalRecordId} is not null) or (${table.generationMode} = 'manual' and ${table.parentVersion} is not null)`,
    ),
  ],
);

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    name: text("name").notNull(),
    category: materialCategory("category").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    summary: text("summary"),
    body: text("body"),
    objectKey: text("object_key"),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("materials", table),
    uniqueIndex("materials_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("materials_id_guest_unique_idx").on(table.id, table.guestSessionId),
  ],
);

export const materialReferences = pgTable(
  "material_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "restrict" }),
    creationProjectId: uuid("creation_project_id")
      .notNull()
      .references(() => creationProjects.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("material_references", table),
    uniqueIndex("material_references_unique_idx").on(table.materialId, table.creationProjectId),
    foreignKey({
      name: "material_references_material_user_owner_fk",
      columns: [table.materialId, table.userId],
      foreignColumns: [materials.id, materials.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "material_references_material_guest_owner_fk",
      columns: [table.materialId, table.guestSessionId],
      foreignColumns: [materials.id, materials.guestSessionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "material_references_project_user_owner_fk",
      columns: [table.creationProjectId, table.userId],
      foreignColumns: [creationProjects.id, creationProjects.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "material_references_project_guest_owner_fk",
      columns: [table.creationProjectId, table.guestSessionId],
      foreignColumns: [creationProjects.id, creationProjects.guestSessionId],
    }).onDelete("cascade"),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    platformAccountId: uuid("platform_account_id"),
    platform: text("platform").notNull(),
    contentTitle: text("content_title").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    status: recordStatus("status").default("draft").notNull(),
    sourceMode: reviewSourceMode("source_mode").default("manual").notNull(),
    privateObjectKey: text("private_object_key"),
    screenshotConsentAt: timestamp("screenshot_consent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("reviews", table),
    uniqueIndex("reviews_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("reviews_id_guest_unique_idx").on(table.id, table.guestSessionId),
    foreignKey({
      name: "reviews_platform_account_user_owner_fk",
      columns: [table.platformAccountId, table.userId],
      foreignColumns: [platformAccounts.id, platformAccounts.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "reviews_platform_account_guest_owner_fk",
      columns: [table.platformAccountId, table.guestSessionId],
      foreignColumns: [platformAccounts.id, platformAccounts.guestSessionId],
    }).onDelete("restrict"),
    check(
      "reviews_screenshot_requires_consent",
      sql`(${table.privateObjectKey} is null) = (${table.screenshotConsentAt} is null)`,
    ),
  ],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    confirmedMetrics: jsonb("confirmed_metrics").$type<Record<string, number | string | null>>().default({}).notNull(),
    calculatedMetrics: jsonb("calculated_metrics").$type<Record<string, number | null>>().default({}).notNull(),
    completeness: integer("completeness").default(0).notNull(),
    corrections: jsonb("corrections").$type<Record<string, unknown>>().default({}).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    userConfirmedAt: timestamp("user_confirmed_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("metric_snapshots_review_idx").on(table.reviewId),
    check("metric_snapshots_completeness_range", sql`${table.completeness} between 0 and 100`),
  ],
);

export const reviewReports = pgTable(
  "review_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    dataSummary: jsonb("data_summary").$type<Record<string, unknown>>().default({}).notNull(),
    keep: jsonb("keep").$type<unknown[]>().default([]).notNull(),
    problems: jsonb("problems").$type<unknown[]>().default([]).notNull(),
    causes: jsonb("causes").$type<unknown[]>().default([]).notNull(),
    recommendations: jsonb("recommendations").$type<unknown[]>().default([]).notNull(),
    citations: jsonb("citations").$type<unknown[]>().default([]).notNull(),
    model: text("model"),
    schemaVersion: integer("schema_version").default(1).notNull(),
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id, {
      onDelete: "restrict",
    }),
    retrievalRecordId: uuid("retrieval_record_id").references(() => retrievalRecords.id, {
      onDelete: "restrict",
    }),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "restrict" }),
    parentVersion: integer("parent_version"),
    generationMode: generationMode("generation_mode").default("ai").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    status: recordStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("review_reports", table),
    index("review_reports_review_idx").on(table.reviewId),
    uniqueIndex("review_reports_review_version_idx").on(table.reviewId, table.version),
    uniqueIndex("review_reports_report_version_idx").on(table.reportId, table.version),
    uniqueIndex("review_reports_ai_run_unique_idx")
      .on(table.aiRunId)
      .where(sql`${table.aiRunId} is not null`),
    foreignKey({
      name: "review_reports_parent_version_fk",
      columns: [table.reportId, table.parentVersion],
      foreignColumns: [table.reportId, table.version],
    }).onDelete("restrict"),
    foreignKey({
      name: "review_reports_report_user_owner_fk",
      columns: [table.reportId, table.userId],
      foreignColumns: [reports.id, reports.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "review_reports_report_guest_owner_fk",
      columns: [table.reportId, table.guestSessionId],
      foreignColumns: [reports.id, reports.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "review_reports_review_user_owner_fk",
      columns: [table.reviewId, table.userId],
      foreignColumns: [reviews.id, reviews.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "review_reports_review_guest_owner_fk",
      columns: [table.reviewId, table.guestSessionId],
      foreignColumns: [reviews.id, reviews.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "review_reports_ai_run_user_owner_fk",
      columns: [table.aiRunId, table.userId],
      foreignColumns: [aiRuns.id, aiRuns.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "review_reports_ai_run_guest_owner_fk",
      columns: [table.aiRunId, table.guestSessionId],
      foreignColumns: [aiRuns.id, aiRuns.guestSessionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "review_reports_retrieval_user_owner_fk",
      columns: [table.retrievalRecordId, table.userId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "review_reports_retrieval_guest_owner_fk",
      columns: [table.retrievalRecordId, table.guestSessionId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.guestSessionId],
    }).onDelete("restrict"),
    check(
      "review_reports_parent_before_child",
      sql`${table.parentVersion} is null or ${table.parentVersion} < ${table.version}`,
    ),
    check(
      "review_reports_provenance_required",
      sql`(${table.generationMode} = 'ai' and ${table.aiRunId} is not null and ${table.model} is not null and ${table.promptVersionId} is not null and ${table.retrievalRecordId} is not null) or (${table.generationMode} = 'manual' and ${table.parentVersion} is not null)`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    title: text("title").notNull(),
    sourceReportId: uuid("source_report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "restrict" }),
    sourceVersion: integer("source_version").notNull(),
    sourceClientId: text("source_client_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>().default({}).notNull(),
    reason: text("reason").notNull(),
    steps: jsonb("steps").$type<string[]>().default([]).notNull(),
    plannedDate: date("planned_date").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    completionCriteria: text("completion_criteria").notNull(),
    priority: integer("priority").default(2).notNull(),
    sortOrder: integer("sort_order").notNull(),
    status: taskStatus("status").default("pending").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("tasks", table),
    index("tasks_actor_status_idx").on(table.status),
    uniqueIndex("tasks_source_identity_unique_idx").on(
      table.sourceReportId,
      table.sourceVersion,
      table.sourceClientId,
    ),
    uniqueIndex("tasks_user_idempotency_unique_idx")
      .on(table.userId, table.idempotencyKey, table.sourceClientId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("tasks_guest_idempotency_unique_idx")
      .on(table.guestSessionId, table.idempotencyKey, table.sourceClientId)
      .where(sql`${table.guestSessionId} is not null`),
    foreignKey({
      name: "tasks_source_report_user_owner_fk",
      columns: [table.sourceReportId, table.userId],
      foreignColumns: [reports.id, reports.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_source_report_guest_owner_fk",
      columns: [table.sourceReportId, table.guestSessionId],
      foreignColumns: [reports.id, reports.guestSessionId],
    }).onDelete("restrict"),
    check("tasks_source_version_positive", sql`${table.sourceVersion} > 0`),
    check(
      "tasks_numeric_ranges",
      sql`${table.estimatedMinutes} between 5 and 1440 and ${table.priority} between 1 and 3 and ${table.sortOrder} >= 0`,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    type: reportType("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: recordStatus("status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("reports", table),
    uniqueIndex("reports_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("reports_id_guest_unique_idx").on(table.id, table.guestSessionId),
  ],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    publicUrl: text("public_url"),
    objectKey: text("object_key"),
    originalMime: text("original_mime"),
    sourceType: text("source_type").notNull(),
    fetchStatus: text("fetch_status")
      .$type<"pending" | "fetched" | "failed">()
      .default("pending")
      .notNull(),
    licenseNote: text("license_note"),
    defaultPlatform: text("default_platform"),
    defaultContentType: text("default_content_type"),
    defaultTags: jsonb("default_tags").$type<string[]>().default([]).notNull(),
    failureCode: text("failure_code"),
    reviewStatus: reviewStatus("review_status").default("pending").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    retrievalScope: retrievalScope("retrieval_scope").default("development_only").notNull(),
    version: integer("version").default(1).notNull(),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    allowAiSend: boolean("allow_ai_send").default(false).notNull(),
    embeddingStatus: text("embedding_status")
      .$type<"pending" | "ready" | "failed" | "not_requested">()
      .default("pending")
      .notNull(),
    embeddingModel: text("embedding_model"),
    embeddingVersion: text("embedding_version"),
    ...timestamps,
  },
  (table) => [
    index("knowledge_sources_name_idx").on(table.name),
    index("knowledge_sources_type_hash_idx").on(table.sourceType, table.contentHash),
    index("knowledge_sources_retrieval_idx").on(table.reviewStatus, table.retrievalScope),
    check(
      "knowledge_sources_production_gate",
      sql`${table.retrievalScope} <> 'production' or (${table.reviewStatus} = 'approved' and ${table.isDemo} = false)`,
    ),
    check(
      "knowledge_sources_fetch_status_valid",
      sql`${table.fetchStatus} in ('pending', 'fetched', 'failed')`,
    ),
    check(
      "knowledge_sources_embedding_status_valid",
      sql`${table.embeddingStatus} in ('pending', 'ready', 'failed', 'not_requested')`,
    ),
  ],
);

export const knowledgeSourceReviewEvents = pgTable(
  "knowledge_source_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    previousReviewStatus: reviewStatus("previous_review_status").notNull(),
    newReviewStatus: reviewStatus("new_review_status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_source_review_events_source_created_idx").on(table.sourceId, table.createdAt),
    index("knowledge_source_review_events_reviewer_idx").on(table.reviewerUserId),
    check(
      "knowledge_source_review_events_new_status_valid",
      sql`${table.newReviewStatus} in ('approved', 'rejected')`,
    ),
    check(
      "knowledge_source_review_events_rejection_reason_required",
      sql`${table.newReviewStatus} <> 'rejected' or (nullif(btrim(${table.reason}), '') is not null)`,
    ),
  ],
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    knowledgeSourceId: uuid("knowledge_source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    platform: text("platform"),
    contentType: text("content_type"),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    title: text("title").notNull(),
    searchableText: text("searchable_text").notNull(),
    chunkIndex: integer("chunk_index").default(0).notNull(),
    charStart: integer("char_start").default(0).notNull(),
    charEnd: integer("char_end").default(0).notNull(),
    structuredConclusion: jsonb("structured_conclusion").$type<Record<string, unknown>>().default({}).notNull(),
    authority: text("authority").notNull(),
    reviewStatus: reviewStatus("review_status").default("pending").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    retrievalScope: retrievalScope("retrieval_scope").default("development_only").notNull(),
    version: integer("version").default(1).notNull(),
    contentHash: text("content_hash").notNull(),
    reviewNote: text("review_note"),
    enabled: boolean("enabled").default(true).notNull(),
    embedding: jsonb("embedding").$type<number[]>(),
    embeddingStatus: text("embedding_status")
      .$type<"pending" | "ready" | "failed" | "not_requested">()
      .default("pending")
      .notNull(),
    embeddingModel: text("embedding_model"),
    embeddingVersion: text("embedding_version"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("knowledge_items_source_idx").on(table.knowledgeSourceId),
    index("knowledge_items_retrieval_idx").on(table.reviewStatus, table.retrievalScope),
    index("knowledge_items_search_idx").using("gin", sql`to_tsvector('simple', ${table.searchableText})`),
    index("knowledge_items_search_trgm_idx").using(
      "gin",
      sql`${table.searchableText} gin_trgm_ops`,
    ),
    check(
      "knowledge_items_production_gate",
      sql`${table.retrievalScope} <> 'production' or (${table.reviewStatus} = 'approved' and ${table.isDemo} = false)`,
    ),
    check("knowledge_items_chunk_index_nonnegative", sql`${table.chunkIndex} >= 0`),
    check(
      "knowledge_items_char_range_valid",
      sql`${table.charStart} >= 0 and ${table.charEnd} >= ${table.charStart}`,
    ),
    check(
      "knowledge_items_embedding_512",
      sql`${table.embedding} is null or case when jsonb_typeof(${table.embedding}) = 'array' then jsonb_array_length(${table.embedding}) = 512 else false end`,
    ),
    check(
      "knowledge_items_embedding_status_valid",
      sql`${table.embeddingStatus} in ('pending', 'ready', 'failed', 'not_requested')`,
    ),
  ],
);

export const knowledgeItemReviewEvents = pgTable(
  "knowledge_item_review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    previousReviewStatus: reviewStatus("previous_review_status").notNull(),
    newReviewStatus: reviewStatus("new_review_status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_item_review_events_item_created_idx").on(table.itemId, table.createdAt),
    index("knowledge_item_review_events_source_created_idx").on(table.sourceId, table.createdAt),
    index("knowledge_item_review_events_reviewer_idx").on(table.reviewerUserId),
    check(
      "knowledge_item_review_events_new_status_valid",
      sql`${table.newReviewStatus} in ('approved', 'rejected')`,
    ),
    check(
      "knowledge_item_review_events_rejection_reason_required",
      sql`${table.newReviewStatus} <> 'rejected' or (nullif(btrim(${table.reason}), '') is not null)`,
    ),
  ],
);

export const knowledgeIngestionJobs = pgTable(
  "knowledge_ingestion_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    inputKind: text("input_kind").$type<"url" | "file" | "text">().notNull(),
    status: text("status")
      .$type<"queued" | "fetching" | "parsing" | "tagging" | "pending_review" | "failed">()
      .notNull(),
    attempt: integer("attempt").default(0).notNull(),
    failureCode: text("failure_code"),
    safeFailureDetail: text("safe_failure_detail"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("knowledge_ingestion_jobs_status_idx").on(table.status, table.createdAt),
    check(
      "knowledge_ingestion_jobs_input_kind_valid",
      sql`${table.inputKind} in ('url', 'file', 'text')`,
    ),
    check(
      "knowledge_ingestion_jobs_status_valid",
      sql`${table.status} in ('queued', 'fetching', 'parsing', 'tagging', 'pending_review', 'failed')`,
    ),
    check("knowledge_ingestion_jobs_attempt_nonnegative", sql`${table.attempt} >= 0`),
  ],
);

export const platformRules = pgTable(
  "platform_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    ruleType: text("rule_type").notNull(),
    body: text("body").notNull(),
    authority: text("authority").default("internal_product_rule").notNull(),
    officialPlatformRule: boolean("official_platform_rule").default(false).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").default(true).notNull(),
    reviewStatus: reviewStatus("review_status").default("pending").notNull(),
    retrievalScope: retrievalScope("retrieval_scope").default("development_only").notNull(),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("platform_rules_identity_idx").on(table.platform, table.ruleType, table.contentHash),
    index("platform_rules_platform_idx").on(
      table.platform,
      table.enabled,
      table.reviewStatus,
      table.retrievalScope,
    ),
    check(
      "platform_rules_production_gate",
      sql`${table.retrievalScope} <> 'production' or ${table.reviewStatus} = 'approved'`,
    ),
  ],
);

export const retrievalRecords = pgTable(
  "retrieval_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    queryHash: text("query_hash").notNull(),
    normalizedKeywords: jsonb("normalized_keywords").$type<string[]>().default([]).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().default({}).notNull(),
    hits: jsonb("hits")
      .$type<
        Array<{
          itemId: string;
          sourceId: string;
          itemVersion: number;
          contentHash: string;
          rank: number;
          score: number | null;
          selected: boolean;
        }>
      >()
      .default([])
      .notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("retrieval_records", table),
    uniqueIndex("retrieval_records_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("retrieval_records_id_guest_unique_idx").on(table.id, table.guestSessionId),
  ],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskType: aiTaskType("task_type").notNull(),
    version: integer("version").notNull(),
    template: text("template").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("prompt_versions_task_version_idx").on(table.taskType, table.version),
    uniqueIndex("prompt_versions_one_active_per_task_idx")
      .on(table.taskType)
      .where(sql`${table.enabled} = true`),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    taskType: aiTaskType("task_type").notNull(),
    positioningSessionId: uuid("positioning_session_id").references(
      () => positioningSessions.id,
      { onDelete: "cascade" },
    ),
    creationProjectId: uuid("creation_project_id").references(() => creationProjects.id, {
      onDelete: "cascade",
    }),
    reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    model: text("model").notNull(),
    schemaVersion: integer("schema_version").default(1).notNull(),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id, { onDelete: "restrict" }),
    retrievalRecordId: uuid("retrieval_record_id").references(() => retrievalRecords.id, {
      onDelete: "restrict",
    }),
    status: recordStatus("status").default("processing").notNull(),
    inputHash: text("input_hash").notNull(),
    safeInputMetadata: jsonb("safe_input_metadata")
      .$type<{
        inputKind: "interview" | "creation_request" | "confirmed_metrics";
        fieldCount: number;
        characterCountBucket: "0" | "1-500" | "501-2000" | "2001+";
      }>()
      .notNull(),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    safeErrorDetail: text("safe_error_detail"),
    retentionUntil: timestamp("retention_until", { withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("ai_runs", table),
    uniqueIndex("ai_runs_id_user_unique_idx").on(table.id, table.userId),
    uniqueIndex("ai_runs_id_guest_unique_idx").on(table.id, table.guestSessionId),
    uniqueIndex("ai_runs_user_idempotency_unique_idx")
      .on(table.userId, table.taskType, table.idempotencyKey)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("ai_runs_guest_idempotency_unique_idx")
      .on(table.guestSessionId, table.taskType, table.idempotencyKey)
      .where(sql`${table.guestSessionId} is not null`),
    uniqueIndex("ai_runs_positioning_processing_unique_idx")
      .on(table.positioningSessionId)
      .where(sql`${table.positioningSessionId} is not null and ${table.status} = 'processing'`),
    foreignKey({
      name: "ai_runs_positioning_user_owner_fk",
      columns: [table.positioningSessionId, table.userId],
      foreignColumns: [positioningSessions.id, positioningSessions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_positioning_guest_owner_fk",
      columns: [table.positioningSessionId, table.guestSessionId],
      foreignColumns: [positioningSessions.id, positioningSessions.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_creation_user_owner_fk",
      columns: [table.creationProjectId, table.userId],
      foreignColumns: [creationProjects.id, creationProjects.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_creation_guest_owner_fk",
      columns: [table.creationProjectId, table.guestSessionId],
      foreignColumns: [creationProjects.id, creationProjects.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_review_user_owner_fk",
      columns: [table.reviewId, table.userId],
      foreignColumns: [reviews.id, reviews.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_review_guest_owner_fk",
      columns: [table.reviewId, table.guestSessionId],
      foreignColumns: [reviews.id, reviews.guestSessionId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_runs_retrieval_user_owner_fk",
      columns: [table.retrievalRecordId, table.userId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_runs_retrieval_guest_owner_fk",
      columns: [table.retrievalRecordId, table.guestSessionId],
      foreignColumns: [retrievalRecords.id, retrievalRecords.guestSessionId],
    }).onDelete("restrict"),
    check(
      "ai_runs_task_subject_match",
      sql`(
        ${table.taskType} in ('profile_extract', 'positioning_report')
        and ${table.positioningSessionId} is not null
        and ${table.creationProjectId} is null
        and ${table.reviewId} is null
      ) or (
        ${table.taskType} = 'content_plan'
        and ${table.positioningSessionId} is null
        and ${table.creationProjectId} is not null
        and ${table.reviewId} is null
      ) or (
        ${table.taskType} = 'review_report'
        and ${table.positioningSessionId} is null
        and ${table.creationProjectId} is null
        and ${table.reviewId} is not null
      )`,
    ),
  ],
);

export const aiUsageRecords = pgTable(
  "ai_usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    aiRunId: uuid("ai_run_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ai_usage_records_run_unique_idx").on(table.aiRunId),
    index("ai_usage_records_user_created_idx").on(table.userId, table.createdAt),
    foreignKey({
      name: "ai_usage_records_run_user_owner_fk",
      columns: [table.aiRunId, table.userId],
      foreignColumns: [aiRuns.id, aiRuns.userId],
    }).onDelete("cascade"),
    check(
      "ai_usage_records_token_counts_nonnegative",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`,
    ),
    check("ai_usage_records_model_supported", sql`${table.model} = 'deepseek-v4-flash'`),
  ],
);

export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...actorColumns,
    eventName: text("event_name").notNull(),
    flow: text("flow"),
    page: text("page"),
    result: text("result"),
    durationBucket: text("duration_bucket"),
    errorType: text("error_type"),
    numericProperties: jsonb("numeric_properties").$type<Record<string, number>>().default({}).notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true })
      .default(sql`now() + interval '90 days'`)
      .notNull(),
    ...timestamps,
  },
  (table) => [
    ...actorConstraints("product_events", table),
    index("product_events_name_created_idx").on(table.eventName, table.createdAt),
  ],
);

export const runtimeHeartbeats = pgTable("runtime_heartbeats", {
  component: text("component").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const PRODUCT_TABLES = {
  aiRuns,
  aiUsageRecords,
  contentPlans,
  creationProjects,
  creatorProfileVersions,
  creatorProfiles,
  guestSessions,
  interviewMessages,
  knowledgeIngestionJobs,
  knowledgeItemReviewEvents,
  knowledgeItems,
  knowledgeSourceReviewEvents,
  knowledgeSources,
  materialReferences,
  materials,
  metricSnapshots,
  platformAccounts,
  platformRules,
  positioningReports,
  positioningSessions,
  productEvents,
  promptVersions,
  reports,
  retrievalRecords,
  reviewReports,
  reviews,
  tasks,
  userSettings,
} as const;

export const ACTOR_OWNED_TABLES = {
  aiRuns,
  contentPlans,
  creationProjects,
  creatorProfileVersions,
  creatorProfiles,
  materialReferences,
  materials,
  platformAccounts,
  positioningReports,
  positioningSessions,
  productEvents,
  reports,
  retrievalRecords,
  reviewReports,
  reviews,
  tasks,
  userSettings,
} as const;

export type ProductionKnowledgeGate = {
  isDemo: boolean;
  reviewStatus: "pending" | "approved" | "rejected";
  retrievalScope: "production" | "development_only";
};

export function isProductionRetrievableKnowledge(item: ProductionKnowledgeGate) {
  return (
    !item.isDemo &&
    item.reviewStatus === "approved" &&
    item.retrievalScope === "production"
  );
}

export function isProductionRetrievableKnowledgePair(
  source: ProductionKnowledgeGate,
  item: ProductionKnowledgeGate,
) {
  return isProductionRetrievableKnowledge(source) && isProductionRetrievableKnowledge(item);
}
