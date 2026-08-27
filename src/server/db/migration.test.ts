import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

test("creates composite owner targets before adding their foreign keys", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0000_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  const targetIndexes = [...migrationSql.matchAll(
    /CREATE UNIQUE INDEX "[^"]+" ON "([^"]+)" USING btree \(("[^"]+","[^"]+")\)/g,
  )].map((match) => ({ table: match[1], columns: match[2], position: match.index }));
  const ownerReferences = [...migrationSql.matchAll(
    /ADD CONSTRAINT "[^"]+_owner_fk" FOREIGN KEY \([^)]*\) REFERENCES "public"\."([^"]+)"\(("[^"]+","[^"]+")\)/g,
  )];
  expect(ownerReferences.length).toBeGreaterThan(0);
  for (const reference of ownerReferences) {
    const target = targetIndexes.find((index) => index.table === reference[1] && index.columns === reference[2]);
    expect(target, `${reference[1]}(${reference[2]})`).toBeDefined();
    expect(target!.position, `${reference[1]}(${reference[2]}) must exist first`).toBeLessThan(reference.index);
  }
});

test("defers every composite owner foreign key for atomic guest migration", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const migrationFile = readdirSync(migrationDirectory).find((file) => file.endsWith(".sql"));

  expect(migrationFile).toBeDefined();

  const migrationSql = readFileSync(resolve(migrationDirectory, migrationFile!), "utf8");
  const ownerConstraints = [
    ...migrationSql.matchAll(/ADD CONSTRAINT "([^"]+_owner_fk)"/g),
  ].map((match) => match[1]);

  expect(ownerConstraints.length).toBeGreaterThan(0);
  for (const constraintName of ownerConstraints) {
    expect(migrationSql).toMatch(
      new RegExp(
        `ALTER TABLE [^;]+ ALTER CONSTRAINT "${constraintName}" DEFERRABLE INITIALLY DEFERRED`,
      ),
    );
  }
});

test("changes converted guest audit ownership with an incremental restrict migration", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const incrementalMigrations = readdirSync(migrationDirectory).filter(
    (file) => file.endsWith(".sql") && !file.startsWith("0000_"),
  );
  const migrationSql = incrementalMigrations
    .map((file) => readFileSync(resolve(migrationDirectory, file), "utf8"))
    .join("\n");

  expect(incrementalMigrations.length).toBeGreaterThan(0);
  expect(migrationSql).toContain(
    'ALTER TABLE "guest_sessions" DROP CONSTRAINT "guest_sessions_converted_to_user_id_user_id_fk"',
  );
  expect(migrationSql).toMatch(
    /FOREIGN KEY \("converted_to_user_id"\) REFERENCES "public"\."user"\("id"\) ON DELETE restrict/,
  );
});

test("keeps composite owner constraints in incremental migrations deferrable", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const incrementalMigrations = readdirSync(migrationDirectory).filter(
    (file) => file.endsWith(".sql") && !file.startsWith("0000_"),
  );

  for (const file of incrementalMigrations) {
    const migrationSql = readFileSync(resolve(migrationDirectory, file), "utf8");
    const ownerConstraints = [
      ...migrationSql.matchAll(/ADD CONSTRAINT "([^"]+_owner_fk)"/g),
    ].map((match) => match[1]);

    for (const constraintName of ownerConstraints) {
      expect(migrationSql, `${file}: ${constraintName}`).toMatch(
        new RegExp(
          `ALTER TABLE [^;]+ ALTER CONSTRAINT "${constraintName}" DEFERRABLE INITIALLY DEFERRED`,
        ),
      );
    }
  }
});

test("backfills positioning state before enforcing incremental constraints", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0005_"));
  expect(file).toBeDefined();
  const sql = readFileSync(resolve(migrationDirectory, file!), "utf8");

  const messageBackfill = sql.indexOf('UPDATE "interview_messages" SET "client_message_id"');
  const messageCheck = sql.indexOf('ADD CONSTRAINT "interview_messages_user_client_id_required"');
  expect(messageBackfill).toBeGreaterThan(-1);
  expect(messageCheck).toBeGreaterThan(messageBackfill);

  const profileBackfill = sql.indexOf('INSERT INTO "creator_profile_versions"');
  expect(profileBackfill).toBeGreaterThan(-1);
  expect(sql).toContain('"source"');
});

test("adds deferrable self references for positioning and profile version parents", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const migrationSql = readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql") && !file.startsWith("0000_"))
    .map((file) => readFileSync(resolve(migrationDirectory, file), "utf8"))
    .join("\n");

  for (const constraintName of [
    "creator_profile_versions_parent_fk",
    "positioning_reports_parent_fk",
  ]) {
    expect(migrationSql).toContain(`ADD CONSTRAINT "${constraintName}"`);
    expect(migrationSql).toMatch(
      new RegExp(`ALTER TABLE [^;]+ ALTER CONSTRAINT "${constraintName}" DEFERRABLE INITIALLY DEFERRED`),
    );
  }
});

test("creates profile provenance targets before deferrable owner references", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0008_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  const targetIndex = migrationSql.indexOf("positioning_reports_report_version_user_unique_idx");
  const sourceForeignKey = migrationSql.indexOf("creator_profile_versions_source_report_user_owner_fk");
  expect(targetIndex).toBeGreaterThan(-1);
  expect(sourceForeignKey).toBeGreaterThan(targetIndex);
  expect(migrationSql).toContain(
    'ALTER CONSTRAINT "creator_profile_versions_source_report_user_owner_fk" DEFERRABLE INITIALLY DEFERRED',
  );
  expect(migrationSql).toContain(
    'ALTER CONSTRAINT "creator_profile_versions_source_report_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED',
  );
});

test("adds content payload provenance and a deferrable plan parent", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0009_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  expect(migrationSql).toContain('ADD COLUMN "content_payload" jsonb');
  expect(migrationSql).toContain('ADD COLUMN "source_snapshot" jsonb');
  expect(migrationSql).toContain('ADD CONSTRAINT "content_plans_parent_version_fk"');
  expect(migrationSql).toContain('ALTER CONSTRAINT "content_plans_parent_version_fk" DEFERRABLE INITIALLY DEFERRED');
});

test("adds a deferrable review report parent", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0010_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  expect(migrationSql).toContain('ADD CONSTRAINT "review_reports_parent_version_fk"');
  expect(migrationSql).toContain('ADD CONSTRAINT "review_reports_parent_before_child"');
  expect(migrationSql).toContain('ALTER CONSTRAINT "review_reports_parent_version_fk" DEFERRABLE INITIALLY DEFERRED');
});

test("adds platform account ownership before review references", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0011_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  const ownerIndex = migrationSql.indexOf('CREATE UNIQUE INDEX "platform_accounts_id_user_unique_idx"');
  const ownerReference = migrationSql.indexOf('ADD CONSTRAINT "reviews_platform_account_user_owner_fk"');
  expect(ownerIndex).toBeGreaterThanOrEqual(0);
  expect(ownerReference).toBeGreaterThan(ownerIndex);
  expect(migrationSql).toContain('ALTER CONSTRAINT "reviews_platform_account_user_owner_fk" DEFERRABLE INITIALLY DEFERRED');
  expect(migrationSql).toContain('ALTER CONSTRAINT "reviews_platform_account_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED');
});

test("gives guest positioning enough quota to finish one complete interview", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const migrationSql = readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql") && !file.startsWith("0000_"))
    .map((file) => readFileSync(resolve(migrationDirectory, file), "utf8"))
    .join("\n");

  expect(migrationSql).toContain('ALTER COLUMN "ai_quota_limit" SET DEFAULT 12');
  expect(migrationSql).toContain('UPDATE "guest_sessions" SET "ai_quota_limit" = 12 WHERE "ai_quota_limit" = 5');
});

test("adds the knowledge ingestion schema with safe historical backfills", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) =>
    name.startsWith("0014_knowledge_ingestion"),
  );
  expect(file).toBeDefined();

  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");
  expect(migrationSql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  expect(migrationSql).toContain('CREATE TABLE "knowledge_ingestion_jobs"');
  expect(migrationSql).toContain(
    'CREATE INDEX "knowledge_sources_type_hash_idx" ON "knowledge_sources" USING btree ("source_type","content_hash")',
  );
  expect(migrationSql).not.toContain(
    'CREATE UNIQUE INDEX "knowledge_sources_type_hash_idx"',
  );
  expect(migrationSql).toContain(
    'CREATE INDEX "knowledge_items_search_trgm_idx" ON "knowledge_items" USING gin ("searchable_text" gin_trgm_ops)',
  );

  for (const column of ["enabled", "chunk_index", "char_start", "char_end"]) {
    expect(migrationSql).toMatch(
      new RegExp(`ADD COLUMN "${column}" [^;]+ DEFAULT [^;]+ NOT NULL`),
    );
  }
  const dropOldNameIndex = migrationSql.indexOf('DROP INDEX "knowledge_sources_name_idx"');
  const createPlainNameIndex = migrationSql.indexOf(
    'CREATE INDEX "knowledge_sources_name_idx" ON "knowledge_sources"',
  );
  expect(dropOldNameIndex).toBeGreaterThan(-1);
  expect(createPlainNameIndex).toBeGreaterThan(dropOldNameIndex);
  for (const constraintName of [
    "knowledge_ingestion_jobs_input_kind_valid",
    "knowledge_ingestion_jobs_status_valid",
    "knowledge_ingestion_jobs_attempt_nonnegative",
    "knowledge_items_chunk_index_nonnegative",
    "knowledge_items_char_range_valid",
    "knowledge_sources_fetch_status_valid",
  ]) {
    expect(migrationSql).toMatch(
      new RegExp(`(?:ADD )?CONSTRAINT "${constraintName}" CHECK`),
    );
  }
});

test("adds append-only knowledge item review events with governed rejection reasons", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0016_"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");

  expect(migrationSql).toContain('CREATE TABLE "knowledge_item_review_events"');
  expect(migrationSql).toContain('"previous_review_status" "review_status" NOT NULL');
  expect(migrationSql).toContain('"new_review_status" "review_status" NOT NULL');
  expect(migrationSql).toContain(
    'CONSTRAINT "knowledge_item_review_events_rejection_reason_required" CHECK',
  );
  expect(migrationSql).toContain(
    'REFERENCES "public"."user"("id") ON DELETE restrict',
  );
});

test("adds governed local semantic RAG fields without a database vector extension", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const file = readdirSync(migrationDirectory).find((name) => name.startsWith("0018_semantic-rag-local"));
  expect(file).toBeDefined();
  const migrationSql = readFileSync(resolve(migrationDirectory, file!), "utf8");

  for (const column of [
    "embedding",
    "embedding_status",
    "embedding_model",
    "embedding_version",
    "default_platform",
    "default_content_type",
    "default_tags",
    "allow_ai_send",
  ]) {
    expect(migrationSql).toContain(`ADD COLUMN "${column}"`);
  }
  expect(migrationSql).toContain('CONSTRAINT "knowledge_items_embedding_512" CHECK');
  expect(migrationSql).not.toMatch(/CREATE EXTENSION.*vector/i);
});
