import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import {
  ACTOR_OWNED_TABLES,
  AUTH_TABLES,
  BETTER_AUTH_DATABASE_ID_GENERATION,
  LOCAL_SECURITY_TABLES,
  PRODUCT_TABLES,
  aiUsageRecords,
  contentPlans,
  deepseekCredentials,
  guestSessions,
  interviewMessages,
  knowledgeItems,
  knowledgeItemReviewEvents,
  knowledgeIngestionJobs,
  knowledgeSourceReviewEvents,
  knowledgeSources,
  materialReferences,
  materials,
  metricSnapshots,
  platformAccounts,
  platformRules,
  positioningReports,
  positioningSessions,
  promptVersions,
  retrievalRecords,
  reviewReports,
  reviews,
  reports,
  aiRuns,
  creationProjects,
  creatorProfileVersions,
  creatorProfiles,
  productEvents,
  runtimeHeartbeats,
  tasks,
  isProductionRetrievableKnowledge,
  isProductionRetrievableKnowledgePair,
  localInstance,
  ownerRecoveryCodes,
} from "./index";

const REQUIRED_TABLES = [
  "aiRuns",
  "aiUsageRecords",
  "contentPlans",
  "creationProjects",
  "creatorProfileVersions",
  "creatorProfiles",
  "guestSessions",
  "interviewMessages",
  "knowledgeItems",
  "knowledgeItemReviewEvents",
  "knowledgeIngestionJobs",
  "knowledgeSourceReviewEvents",
  "knowledgeSources",
  "materialReferences",
  "materials",
  "metricSnapshots",
  "platformAccounts",
  "platformRules",
  "positioningReports",
  "positioningSessions",
  "productEvents",
  "promptVersions",
  "reports",
  "retrievalRecords",
  "reviewReports",
  "reviews",
  "tasks",
  "userSettings",
] as const;

describe("product database schema", () => {
  test("declares the worker heartbeat operational table", () => {
    const config = getTableConfig(runtimeHeartbeats);
    expect(config.name).toBe("runtime_heartbeats");
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["component", "updated_at"]),
    );
  });

  test("declares every required product table", () => {
    expect(Object.keys(PRODUCT_TABLES).sort()).toEqual([...REQUIRED_TABLES].sort());
  });

  test("enforces exactly one actor and owner indexes on private records", () => {
    for (const table of Object.values(ACTOR_OWNED_TABLES) as PgTable[]) {
      const config = getTableConfig(table);
      const columnNames = config.columns.map((column) => column.name);
      const indexNames = config.indexes.map((item) => item.config.name);
      const checkNames = config.checks.map((item) => item.name);

      expect(columnNames, `${config.name} actor columns`).toEqual(
        expect.arrayContaining(["user_id", "guest_session_id"]),
      );
      expect(checkNames, `${config.name} exactly-one actor check`).toContain(
        `${config.name}_exactly_one_actor`,
      );
      expect(indexNames, `${config.name} user owner index`).toContain(
        `${config.name}_user_owner_idx`,
      );
      expect(indexNames, `${config.name} guest owner index`).toContain(
        `${config.name}_guest_owner_idx`,
      );
    }
  });

  test("production retrieval excludes unreviewed and internal demo knowledge", () => {
    expect(
      isProductionRetrievableKnowledge({
        isDemo: false,
        reviewStatus: "approved",
        retrievalScope: "production",
      }),
    ).toBe(true);

    for (const item of [
      {
        isDemo: false,
        reviewStatus: "pending",
        retrievalScope: "production",
      },
      {
        isDemo: true,
        reviewStatus: "approved",
        retrievalScope: "development_only",
      },
      {
        isDemo: false,
        reviewStatus: "approved",
        retrievalScope: "development_only",
      },
    ] as const) {
      expect(isProductionRetrievableKnowledge(item)).toBe(false);
    }
  });

  test("production retrieval requires both source and item approval", () => {
    const approved = {
      isDemo: false,
      reviewStatus: "approved" as const,
      retrievalScope: "production" as const,
    };

    expect(isProductionRetrievableKnowledgePair(approved, approved)).toBe(true);
    expect(
      isProductionRetrievableKnowledgePair(
        { ...approved, reviewStatus: "pending" },
        approved,
      ),
    ).toBe(false);
  });

  test("uses Better Auth's standard table names as the only auth source of truth", () => {
    expect(BETTER_AUTH_DATABASE_ID_GENERATION).toBe("uuid");
    expect(
      Object.fromEntries(
        Object.entries(AUTH_TABLES).map(([key, table]) => [key, getTableConfig(table).name]),
      ),
    ).toEqual({
      accounts: "account",
      sessions: "session",
      users: "user",
      verifications: "verification",
    });
  });

  test("stores one local Owner and only encrypted provider credentials", () => {
    expect(Object.keys(LOCAL_SECURITY_TABLES).sort()).toEqual(
      ["deepseekCredentials", "localInstance", "ownerRecoveryCodes"].sort(),
    );
    expect(getTableConfig(localInstance).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "singleton_key",
        "owner_user_id",
        "initialized_at",
        "product_version",
      ]),
    );
    expect(getTableConfig(ownerRecoveryCodes).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["user_id", "code_hash", "consumed_at"]),
    );
    expect(getTableConfig(deepseekCredentials).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "user_id",
        "envelope_version",
        "ciphertext",
        "iv",
        "auth_tag",
        "last_four",
        "consented_at",
        "tested_at",
        "revoked_at",
      ]),
    );
    expect(getTableConfig(deepseekCredentials).columns.map((column) => column.name)).not.toContain(
      "api_key",
    );
  });

  test("records nonnegative per-run DeepSeek token usage inside the Owner boundary", () => {
    const config = getTableConfig(aiUsageRecords);
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "ai_run_id",
        "user_id",
        "model",
        "input_tokens",
        "output_tokens",
      ]),
    );
    expect(config.checks.map((item) => item.name)).toContain(
      "ai_usage_records_token_counts_nonnegative",
    );
    expect(
      config.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      })),
    ).toContainEqual({
      columns: ["ai_run_id", "user_id"],
      foreignColumns: ["id", "user_id"],
    });
  });

  test("keeps one knowledge review state and no duplicate approval boolean", () => {
    for (const table of [knowledgeSources, knowledgeItems]) {
      expect(getTableConfig(table).columns.map((column) => column.name)).not.toContain("approved");
    }
  });

  test("knowledge ingestion has review-safe state and searchable chunks", () => {
    expect(knowledgeIngestionJobs).toBeDefined();
    expect(getTableConfig(knowledgeSourceReviewEvents).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "source_id",
        "reviewer_user_id",
        "previous_review_status",
        "new_review_status",
        "reason",
      ]),
    );
    expect(getTableConfig(knowledgeSourceReviewEvents).checks.map((item) => item.name)).toContain(
      "knowledge_source_review_events_rejection_reason_required",
    );
    expect(getTableConfig(knowledgeItemReviewEvents).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "item_id",
        "source_id",
        "reviewer_user_id",
        "previous_review_status",
        "new_review_status",
        "reason",
      ]),
    );
    expect(getTableConfig(knowledgeItemReviewEvents).checks.map((item) => item.name)).toContain(
      "knowledge_item_review_events_rejection_reason_required",
    );
    expect(getTableConfig(knowledgeItems).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "chunk_index",
        "char_start",
        "char_end",
        "review_note",
        "enabled",
        "embedding",
        "embedding_status",
        "embedding_model",
        "embedding_version",
      ]),
    );
    expect(getTableConfig(knowledgeSources).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "object_key",
        "original_mime",
        "fetch_status",
        "license_note",
        "default_platform",
        "default_content_type",
        "default_tags",
        "failure_code",
        "processed_at",
        "allow_ai_send",
        "embedding_status",
        "embedding_model",
        "embedding_version",
      ]),
    );

    const sourceHashIndex = getTableConfig(knowledgeSources).indexes.find(
      (item) => item.config.name === "knowledge_sources_type_hash_idx",
    );
    expect(sourceHashIndex?.config.unique).toBe(false);
    expect(getTableConfig(knowledgeSources).checks.map((item) => item.name)).toContain(
      "knowledge_sources_fetch_status_valid",
    );

    expect(getTableConfig(knowledgeIngestionJobs).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "knowledge_ingestion_jobs_input_kind_valid",
        "knowledge_ingestion_jobs_status_valid",
        "knowledge_ingestion_jobs_attempt_nonnegative",
      ]),
    );
    expect(getTableConfig(knowledgeItems).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "knowledge_items_chunk_index_nonnegative",
        "knowledge_items_char_range_valid",
        "knowledge_items_embedding_512",
      ]),
    );
    expect(getTableConfig(knowledgeSources).columns.find((column) => column.name === "allow_ai_send")?.hasDefault).toBe(true);
  });

  test("stores only user-confirmed OCR metrics by default", () => {
    const columns = getTableConfig(metricSnapshots).columns.map((column) => column.name);

    expect(columns).toContain("confirmed_metrics");
    expect(columns).not.toEqual(expect.arrayContaining(["raw_ocr_text", "screenshot_data"]));
  });

  test("records generation lineage on every AI-generated report", () => {
    for (const table of [positioningReports, contentPlans, reviewReports]) {
      const columns = getTableConfig(table).columns.map((column) => column.name);

      expect(columns, `${getTableConfig(table).name} generation lineage`).toEqual(
        expect.arrayContaining([
          "model",
          "prompt_version_id",
          "retrieval_record_id",
          "schema_version",
        ]),
      );
    }
  });

  test("child records inherit ownership from their aggregate root", () => {
    for (const table of [interviewMessages, metricSnapshots]) {
      expect(getTableConfig(table).columns.map((column) => column.name)).not.toEqual(
        expect.arrayContaining(["user_id", "guest_session_id"]),
      );
    }
  });

  test("material references cannot connect records owned by another actor", () => {
    const references = getTableConfig(materialReferences).foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));

    expect(references).toEqual(
      expect.arrayContaining([
        { columns: ["material_id", "user_id"], foreignColumns: ["id", "user_id"] },
        {
          columns: ["material_id", "guest_session_id"],
          foreignColumns: ["id", "guest_session_id"],
        },
        {
          columns: ["creation_project_id", "user_id"],
          foreignColumns: ["id", "user_id"],
        },
        {
          columns: ["creation_project_id", "guest_session_id"],
          foreignColumns: ["id", "guest_session_id"],
        },
      ]),
    );
  });

  test("saved review screenshots require explicit consent and vice versa", () => {
    expect(getTableConfig(reviews).checks.map((item) => item.name)).toContain(
      "reviews_screenshot_requires_consent",
    );
  });

  test("distinguishes assistant interview messages from user actors", () => {
    const sender = getTableConfig(interviewMessages).columns.find(
      (column) => column.name === "sender",
    );

    expect(sender?.enumValues).toEqual(["user", "assistant", "system"]);
  });

  test("keeps immutable profile versions and an active head", () => {
    expect(getTableConfig(creatorProfiles).columns.map((column) => column.name)).toContain("version");
    const versionConfig = getTableConfig(creatorProfileVersions);
    expect(versionConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["creator_profile_id", "version", "parent_version", "snapshot"]),
    );
    expect(versionConfig.indexes.find((item) => item.config.name === "creator_profile_versions_profile_version_idx")?.config.unique).toBe(true);
  });

  test("requires every manual parent version to exist in the same aggregate", () => {
    const profileVersionReferences = getTableConfig(creatorProfileVersions).foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      foreignTable: getTableConfig(foreignKey.reference().foreignTable).name,
    }));
    const typedReports = [positioningReports, contentPlans, reviewReports];

    expect(profileVersionReferences).toContainEqual({
      columns: ["creator_profile_id", "parent_version"],
      foreignColumns: ["creator_profile_id", "version"],
      foreignTable: "creator_profile_versions",
    });
    for (const table of typedReports) {
      const config = getTableConfig(table);
      const references = config.foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
        foreignTable: getTableConfig(foreignKey.reference().foreignTable).name,
      }));
      expect(references).toContainEqual({
        columns: ["report_id", "parent_version"],
        foreignColumns: ["report_id", "version"],
        foreignTable: config.name,
      });
      expect(config.checks.map((item) => item.name)).toContain(`${config.name}_parent_before_child`);
    }
  });

  test("keeps profile-version report provenance in the same owner boundary", () => {
    const config = getTableConfig(creatorProfileVersions);
    const references = config.foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));
    expect(references).toContainEqual({
      name: "creator_profile_versions_source_report_user_owner_fk",
      columns: ["source_report_id", "source_report_version", "user_id"],
      foreignColumns: ["report_id", "version", "user_id"],
    });
    expect(references).toContainEqual({
      name: "creator_profile_versions_source_report_guest_owner_fk",
      columns: ["source_report_id", "source_report_version", "guest_session_id"],
      foreignColumns: ["report_id", "version", "guest_session_id"],
    });
    expect(config.checks.map((item) => item.name)).toContain(
      "creator_profile_versions_source_pair",
    );
  });

  test("bounds interview steps and makes client message ids idempotent", () => {
    expect(getTableConfig(positioningSessions).checks.map((item) => item.name)).toContain(
      "positioning_sessions_current_step_range",
    );
    const messageConfig = getTableConfig(interviewMessages);
    expect(messageConfig.columns.map((column) => column.name)).toContain("client_message_id");
    const idempotencyIndex = messageConfig.indexes.find(
      (item) => item.config.name === "interview_messages_session_client_unique_idx",
    );
    expect(idempotencyIndex?.config.unique).toBe(true);
    expect(idempotencyIndex?.config.where).toBeDefined();
  });

  test("keeps retrieval logs private-safe and versioned", () => {
    const columns = getTableConfig(retrievalRecords).columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining(["query_hash", "normalized_keywords", "filters", "hits"]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining(["query", "recalled_item_ids", "selected_item_ids"]),
    );
  });

  test("applies review and scope gates to platform rules", () => {
    expect(getTableConfig(platformRules).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["review_status", "retrieval_scope", "content_hash", "captured_at"]),
    );
  });

  test("allows at most one active prompt per AI task", () => {
    const activeIndex = getTableConfig(promptVersions).indexes.find(
      (item) => item.config.name === "prompt_versions_one_active_per_task_idx",
    );

    expect(activeIndex?.config.unique).toBe(true);
    expect(activeIndex?.config.where).toBeDefined();
  });

  test("snapshots task sources instead of polymorphic loose ids", () => {
    const config = getTableConfig(tasks);
    const columns = config.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "source_report_id",
        "source_version",
        "source_snapshot",
        "source_client_id",
        "idempotency_key",
        "sort_order",
        "planned_date",
      ]),
    );
    expect(columns).not.toEqual(expect.arrayContaining(["source_id", "planned_for"]));

    for (const required of [
      "source_client_id",
      "idempotency_key",
      "sort_order",
      "planned_date",
      "estimated_minutes",
      "completion_criteria",
    ]) {
      expect(config.columns.find((column) => column.name === required)?.notNull).toBe(true);
    }

    const sourceIdentity = config.indexes.find(
      (item) => item.config.name === "tasks_source_identity_unique_idx",
    );
    expect(sourceIdentity?.config.unique).toBe(true);
    expect(sourceIdentity?.config.columns.map((column) => "name" in column ? column.name : null)).toEqual([
      "source_report_id",
      "source_version",
      "source_client_id",
    ]);

    for (const [indexName, ownerColumn] of [
      ["tasks_user_idempotency_unique_idx", "user_id"],
      ["tasks_guest_idempotency_unique_idx", "guest_session_id"],
    ] as const) {
      const index = config.indexes.find((item) => item.config.name === indexName);
      expect(index?.config.unique).toBe(true);
      expect(index?.config.columns.map((column) => "name" in column ? column.name : null)).toEqual([
        ownerColumn,
        "idempotency_key",
        "source_client_id",
      ]);
    }
  });

  test("limits material categories and protects active references", () => {
    const materialConfig = getTableConfig(materials);
    const category = materialConfig.columns.find((column) => column.name === "category");
    expect(category?.enumValues).toEqual(["inspiration", "history_content"]);
    expect(category?.notNull).toBe(true);

    const materialForeignKeys = getTableConfig(materialReferences).foreignKeys.filter(
      (foreignKey) => foreignKey.reference().columns[0]?.name === "material_id",
    );
    expect(materialForeignKeys.length).toBeGreaterThan(0);
    expect(materialForeignKeys.every((foreignKey) => foreignKey.onDelete === "restrict")).toBe(true);
  });

  test("tracks guest revocation and bounded AI quota", () => {
    const config = getTableConfig(guestSessions);
    const columns = config.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "revoked_at",
        "last_seen_at",
        "ai_quota_used",
        "ai_quota_limit",
      ]),
    );
    expect(config.checks.map((item) => item.name)).toContain("guest_sessions_ai_quota_range");
    expect(config.columns.find((column) => column.name === "ai_quota_limit")?.default).toBe(12);
  });

  test("uses reports as the owned aggregate root for typed versions", () => {
    const rootColumns = getTableConfig(reports).columns.map((column) => column.name);

    expect(rootColumns).not.toEqual(
      expect.arrayContaining([
        "source_id",
        "source_version",
        "source_snapshot",
        "version",
        "positioning_report_id",
        "content_plan_id",
        "review_report_id",
      ]),
    );
    for (const table of [positioningReports, contentPlans, reviewReports]) {
      expect(getTableConfig(table).columns.map((column) => column.name)).toContain("report_id");
    }
  });

  test("prevents tasks from referencing another actor's report", () => {
    const references = getTableConfig(tasks).foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));

    expect(references).toEqual(
      expect.arrayContaining([
        { columns: ["source_report_id", "user_id"], foreignColumns: ["id", "user_id"] },
        {
          columns: ["source_report_id", "guest_session_id"],
          foreignColumns: ["id", "guest_session_id"],
        },
      ]),
    );
  });

  test("typed report versions cannot cross report or business-root ownership", () => {
    for (const [table, businessColumn] of [
      [positioningReports, "positioning_session_id"],
      [contentPlans, "creation_project_id"],
      [reviewReports, "review_id"],
    ] as const) {
      const references = getTableConfig(table).foreignKeys.map((foreignKey) =>
        foreignKey.reference().columns.map((column) => column.name),
      );

      expect(references).toEqual(
        expect.arrayContaining([
          ["report_id", "user_id"],
          ["report_id", "guest_session_id"],
          [businessColumn, "user_id"],
          [businessColumn, "guest_session_id"],
        ]),
      );
    }
  });

  test("enforces provenance requirements for AI and user report versions", () => {
    for (const table of [positioningReports, contentPlans, reviewReports]) {
      expect(getTableConfig(table).checks.map((item) => item.name)).toContain(
        `${getTableConfig(table).name}_provenance_required`,
      );
    }
  });

  test("prevents unreviewed knowledge and rules from being marked production", () => {
    for (const table of [knowledgeSources, knowledgeItems, platformRules]) {
      expect(getTableConfig(table).checks.map((item) => item.name)).toContain(
        `${getTableConfig(table).name}_production_gate`,
      );
    }
  });

  test("sets finite retention defaults for transient operational metadata", () => {
    for (const [table, columnName] of [
      [retrievalRecords, "retention_until"],
      [aiRuns, "retention_until"],
      [productEvents, "retention_until"],
    ] as const) {
      const column = getTableConfig(table).columns.find((item) => item.name === columnName);
      expect(column?.notNull).toBe(true);
      expect(column?.hasDefault).toBe(true);
    }
  });

  test("keeps guest conversion fields consistent", () => {
    expect(getTableConfig(guestSessions).checks.map((item) => item.name)).toContain(
      "guest_sessions_conversion_pair",
    );
  });

  test("names AI metadata fields to prevent raw content logging", () => {
    const columns = getTableConfig(aiRuns).columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining(["input_hash", "safe_input_metadata", "safe_error_detail"]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining(["input_summary", "error_message", "output_record_id"]),
    );
  });

  test("binds every AI run to exactly one owned business object and an idempotency key", () => {
    const config = getTableConfig(aiRuns);
    const columns = config.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "positioning_session_id",
        "creation_project_id",
        "review_id",
        "idempotency_key",
      ]),
    );
    expect(config.checks.map((item) => item.name)).toContain("ai_runs_task_subject_match");

    for (const [businessTable, businessColumn] of [
      [positioningSessions, "positioning_session_id"],
      [creationProjects, "creation_project_id"],
      [reviews, "review_id"],
    ] as const) {
      const expectedTable = getTableConfig(businessTable).name;
      const references = config.foreignKeys
        .map((foreignKey) => foreignKey.reference())
        .filter((reference) => getTableConfig(reference.foreignTable).name === expectedTable)
        .map((reference) => ({
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
        }));

      expect(references).toEqual(
        expect.arrayContaining([
          { columns: [businessColumn, "user_id"], foreignColumns: ["id", "user_id"] },
          {
            columns: [businessColumn, "guest_session_id"],
            foreignColumns: ["id", "guest_session_id"],
          },
        ]),
      );
    }

    for (const [indexName, ownerColumn] of [
      ["ai_runs_user_idempotency_unique_idx", "user_id"],
      ["ai_runs_guest_idempotency_unique_idx", "guest_session_id"],
    ] as const) {
      const index = config.indexes.find((item) => item.config.name === indexName);
      expect(index?.config.unique).toBe(true);
      expect(index?.config.where).toBeDefined();
      expect(index?.config.columns.map((column) => "name" in column ? column.name : null)).toEqual([
        ownerColumn,
        "task_type",
        "idempotency_key",
      ]);
    }
  });

  test("typed AI reports keep AI-run and retrieval ownership aligned", () => {
    for (const table of [positioningReports, contentPlans, reviewReports]) {
      const config = getTableConfig(table);
      const references = getTableConfig(table).foreignKeys.map((foreignKey) => ({
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
        foreignTable: getTableConfig(foreignKey.reference().foreignTable).name,
      }));
      const aiRunIndex = config.indexes.find(
        (item) => item.config.name === `${config.name}_ai_run_unique_idx`,
      );
      expect(aiRunIndex?.config.unique).toBe(true);
      expect(aiRunIndex?.config.where).toBeDefined();

      for (const foreignTable of ["ai_runs", "retrieval_records"]) {
        expect(references).toEqual(
          expect.arrayContaining([
            {
              columns: [foreignTable === "ai_runs" ? "ai_run_id" : "retrieval_record_id", "user_id"],
              foreignColumns: ["id", "user_id"],
              foreignTable,
            },
            {
              columns: [
                foreignTable === "ai_runs" ? "ai_run_id" : "retrieval_record_id",
                "guest_session_id",
              ],
              foreignColumns: ["id", "guest_session_id"],
              foreignTable,
            },
          ]),
        );
      }
    }
  });

  test("keeps review metrics assigned to one explicit platform account", () => {
    const accountConfig = getTableConfig(platformAccounts);
    expect(accountConfig.columns.map((column) => column.name)).toContain("is_active");
    for (const name of ["platform_accounts_active_user_idx", "platform_accounts_active_guest_idx"]) {
      const index = accountConfig.indexes.find((item) => item.config.name === name);
      expect(index?.config.unique).toBe(true);
      expect(index?.config.where).toBeDefined();
    }
    const references = getTableConfig(reviews).foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      foreignTable: getTableConfig(foreignKey.reference().foreignTable).name,
    }));
    expect(references).toEqual(expect.arrayContaining([
      { columns: ["platform_account_id", "user_id"], foreignColumns: ["id", "user_id"], foreignTable: "platform_accounts" },
      { columns: ["platform_account_id", "guest_session_id"], foreignColumns: ["id", "guest_session_id"], foreignTable: "platform_accounts" },
    ]));
  });
});
