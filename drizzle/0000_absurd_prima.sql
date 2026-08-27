CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('guest', 'user');--> statement-breakpoint
CREATE TYPE "public"."ai_task_type" AS ENUM('profile_extract', 'positioning_report', 'content_plan', 'review_report');--> statement-breakpoint
CREATE TYPE "public"."generation_mode" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('draft', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('positioning', 'creation', 'review');--> statement-breakpoint
CREATE TYPE "public"."retrieval_scope" AS ENUM('production', 'development_only');--> statement-breakpoint
CREATE TYPE "public"."review_source_mode" AS ENUM('manual', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'dismissed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"converted_to_user_id" uuid,
	"converted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_quota_used" integer DEFAULT 0 NOT NULL,
	"ai_quota_limit" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_sessions_ai_quota_range" CHECK ("guest_sessions"."ai_quota_used" >= 0 and "guest_sessions"."ai_quota_limit" >= 0 and "guest_sessions"."ai_quota_used" <= "guest_sessions"."ai_quota_limit"),
	CONSTRAINT "guest_sessions_conversion_pair" CHECK (("guest_sessions"."converted_to_user_id" is null) = ("guest_sessions"."converted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"account_status" "account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"task_type" "ai_task_type" NOT NULL,
	"model" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"retrieval_record_id" uuid,
	"status" "record_status" DEFAULT 'processing' NOT NULL,
	"input_hash" text NOT NULL,
	"safe_input_metadata" jsonb NOT NULL,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" text,
	"safe_error_detail" text,
	"retention_until" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_exactly_one_actor" CHECK (num_nonnulls("ai_runs"."user_id", "ai_runs"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "content_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"report_id" uuid NOT NULL,
	"creation_project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text NOT NULL,
	"media_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platform_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prompt_version_id" uuid,
	"retrieval_record_id" uuid,
	"ai_run_id" uuid,
	"parent_version" integer,
	"generation_mode" "generation_mode" DEFAULT 'ai' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_plans_exactly_one_actor" CHECK (num_nonnulls("content_plans"."user_id", "content_plans"."guest_session_id") = 1),
	CONSTRAINT "content_plans_provenance_required" CHECK (("content_plans"."generation_mode" = 'ai' and "content_plans"."ai_run_id" is not null and "content_plans"."model" is not null and "content_plans"."prompt_version_id" is not null and "content_plans"."retrieval_record_id" is not null) or ("content_plans"."generation_mode" = 'manual' and "content_plans"."parent_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "creation_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"content_type" text NOT NULL,
	"platform" text NOT NULL,
	"goal" text NOT NULL,
	"requirements" text,
	"available_minutes" integer,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_projects_exactly_one_actor" CHECK (num_nonnulls("creation_projects"."user_id", "creation_projects"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"profile_dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_positioning" text,
	"target_audience" text,
	"content_direction" text,
	"platform_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"material_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"merge_state" text DEFAULT 'clean' NOT NULL,
	"source_guest_session_id" uuid,
	"guest_draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_exactly_one_actor" CHECK (num_nonnulls("creator_profiles"."user_id", "creator_profiles"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "interview_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"positioning_session_id" uuid NOT NULL,
	"sender" "message_role" NOT NULL,
	"content" text NOT NULL,
	"extracted_profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_source_id" uuid NOT NULL,
	"platform" text,
	"content_type" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"searchable_text" text NOT NULL,
	"structured_conclusion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authority" text NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"retrieval_scope" "retrieval_scope" DEFAULT 'development_only' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_items_production_gate" CHECK ("knowledge_items"."retrieval_scope" <> 'production' or ("knowledge_items"."review_status" = 'approved' and "knowledge_items"."is_demo" = false))
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"public_url" text,
	"source_type" text NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"retrieval_scope" "retrieval_scope" DEFAULT 'development_only' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_production_gate" CHECK ("knowledge_sources"."retrieval_scope" <> 'production' or ("knowledge_sources"."review_status" = 'approved' and "knowledge_sources"."is_demo" = false))
);
--> statement-breakpoint
CREATE TABLE "material_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"material_id" uuid NOT NULL,
	"creation_project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_references_exactly_one_actor" CHECK (num_nonnulls("material_references"."user_id", "material_references"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"body" text,
	"object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_exactly_one_actor" CHECK (num_nonnulls("materials"."user_id", "materials"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"confirmed_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculated_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness" integer DEFAULT 0 NOT NULL,
	"corrections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"user_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_completeness_range" CHECK ("metric_snapshots"."completeness" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"platform" text NOT NULL,
	"account_label" text,
	"data_source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_accounts_exactly_one_actor" CHECK (num_nonnulls("platform_accounts"."user_id", "platform_accounts"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "platform_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"rule_type" text NOT NULL,
	"body" text NOT NULL,
	"authority" text DEFAULT 'internal_product_rule' NOT NULL,
	"official_platform_rule" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"source_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"retrieval_scope" "retrieval_scope" DEFAULT 'development_only' NOT NULL,
	"content_hash" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_rules_production_gate" CHECK ("platform_rules"."retrieval_scope" <> 'production' or "platform_rules"."review_status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "positioning_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"report_id" uuid NOT NULL,
	"positioning_session_id" uuid NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_candidate" jsonb,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prompt_version_id" uuid,
	"retrieval_record_id" uuid,
	"ai_run_id" uuid,
	"parent_version" integer,
	"generation_mode" "generation_mode" DEFAULT 'ai' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positioning_reports_exactly_one_actor" CHECK (num_nonnulls("positioning_reports"."user_id", "positioning_reports"."guest_session_id") = 1),
	CONSTRAINT "positioning_reports_provenance_required" CHECK (("positioning_reports"."generation_mode" = 'ai' and "positioning_reports"."ai_run_id" is not null and "positioning_reports"."model" is not null and "positioning_reports"."prompt_version_id" is not null and "positioning_reports"."retrieval_record_id" is not null) or ("positioning_reports"."generation_mode" = 'manual' and "positioning_reports"."parent_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "positioning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"completeness" integer DEFAULT 0 NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positioning_sessions_exactly_one_actor" CHECK (num_nonnulls("positioning_sessions"."user_id", "positioning_sessions"."guest_session_id") = 1),
	CONSTRAINT "positioning_sessions_completeness_range" CHECK ("positioning_sessions"."completeness" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"event_name" text NOT NULL,
	"flow" text,
	"page" text,
	"result" text,
	"duration_bucket" text,
	"error_type" text,
	"numeric_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_exactly_one_actor" CHECK (num_nonnulls("product_events"."user_id", "product_events"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" "ai_task_type" NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"type" "report_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_exactly_one_actor" CHECK (num_nonnulls("reports"."user_id", "reports"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "retrieval_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"query_hash" text NOT NULL,
	"normalized_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_records_exactly_one_actor" CHECK (num_nonnulls("retrieval_records"."user_id", "retrieval_records"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"report_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"data_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"keep" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"causes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"prompt_version_id" uuid,
	"retrieval_record_id" uuid,
	"ai_run_id" uuid,
	"parent_version" integer,
	"generation_mode" "generation_mode" DEFAULT 'ai' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_reports_exactly_one_actor" CHECK (num_nonnulls("review_reports"."user_id", "review_reports"."guest_session_id") = 1),
	CONSTRAINT "review_reports_provenance_required" CHECK (("review_reports"."generation_mode" = 'ai' and "review_reports"."ai_run_id" is not null and "review_reports"."model" is not null and "review_reports"."prompt_version_id" is not null and "review_reports"."retrieval_record_id" is not null) or ("review_reports"."generation_mode" = 'manual' and "review_reports"."parent_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"platform" text NOT NULL,
	"content_title" text NOT NULL,
	"published_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"status" "record_status" DEFAULT 'draft' NOT NULL,
	"source_mode" "review_source_mode" DEFAULT 'manual' NOT NULL,
	"private_object_key" text,
	"screenshot_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_exactly_one_actor" CHECK (num_nonnulls("reviews"."user_id", "reviews"."guest_session_id") = 1),
	CONSTRAINT "reviews_screenshot_requires_consent" CHECK (("reviews"."private_object_key" is null) = ("reviews"."screenshot_consent_at" is null))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"title" text NOT NULL,
	"source_report_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_for" timestamp with time zone,
	"estimated_minutes" integer,
	"completion_criteria" text,
	"priority" integer DEFAULT 2 NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_exactly_one_actor" CHECK (num_nonnulls("tasks"."user_id", "tasks"."guest_session_id") = 1),
	CONSTRAINT "tasks_source_version_positive" CHECK ("tasks"."source_version" > 0),
	CONSTRAINT "tasks_numeric_ranges" CHECK (("tasks"."estimated_minutes" is null or "tasks"."estimated_minutes" >= 0) and "tasks"."priority" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"email_reminders" boolean DEFAULT true NOT NULL,
	"product_updates" boolean DEFAULT false NOT NULL,
	"privacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merge_state" text DEFAULT 'clean' NOT NULL,
	"source_guest_session_id" uuid,
	"guest_draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_exactly_one_actor" CHECK (num_nonnulls("user_settings"."user_id", "user_settings"."guest_session_id") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creation_projects_id_user_unique_idx" ON "creation_projects" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creation_projects_id_guest_unique_idx" ON "creation_projects" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_id_user_unique_idx" ON "materials" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_id_guest_unique_idx" ON "materials" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positioning_sessions_id_user_unique_idx" ON "positioning_sessions" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positioning_sessions_id_guest_unique_idx" ON "positioning_sessions" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_id_user_unique_idx" ON "reports" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_id_guest_unique_idx" ON "reports" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_records_id_user_unique_idx" ON "retrieval_records" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_records_id_guest_unique_idx" ON "retrieval_records" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_id_user_unique_idx" ON "reviews" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_id_guest_unique_idx" ON "reviews" USING btree ("id","guest_session_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_converted_to_user_id_user_id_fk" FOREIGN KEY ("converted_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_retrieval_record_id_retrieval_records_id_fk" FOREIGN KEY ("retrieval_record_id") REFERENCES "public"."retrieval_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_retrieval_user_owner_fk" FOREIGN KEY ("retrieval_record_id","user_id") REFERENCES "public"."retrieval_records"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_retrieval_guest_owner_fk" FOREIGN KEY ("retrieval_record_id","guest_session_id") REFERENCES "public"."retrieval_records"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_creation_project_id_creation_projects_id_fk" FOREIGN KEY ("creation_project_id") REFERENCES "public"."creation_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_retrieval_record_id_retrieval_records_id_fk" FOREIGN KEY ("retrieval_record_id") REFERENCES "public"."retrieval_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_report_user_owner_fk" FOREIGN KEY ("report_id","user_id") REFERENCES "public"."reports"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_report_guest_owner_fk" FOREIGN KEY ("report_id","guest_session_id") REFERENCES "public"."reports"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_project_user_owner_fk" FOREIGN KEY ("creation_project_id","user_id") REFERENCES "public"."creation_projects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_project_guest_owner_fk" FOREIGN KEY ("creation_project_id","guest_session_id") REFERENCES "public"."creation_projects"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_projects" ADD CONSTRAINT "creation_projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creation_projects" ADD CONSTRAINT "creation_projects_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_source_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("source_guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_positioning_session_id_positioning_sessions_id_fk" FOREIGN KEY ("positioning_session_id") REFERENCES "public"."positioning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_knowledge_source_id_knowledge_sources_id_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_creation_project_id_creation_projects_id_fk" FOREIGN KEY ("creation_project_id") REFERENCES "public"."creation_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_user_owner_fk" FOREIGN KEY ("material_id","user_id") REFERENCES "public"."materials"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_guest_owner_fk" FOREIGN KEY ("material_id","guest_session_id") REFERENCES "public"."materials"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_project_user_owner_fk" FOREIGN KEY ("creation_project_id","user_id") REFERENCES "public"."creation_projects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_project_guest_owner_fk" FOREIGN KEY ("creation_project_id","guest_session_id") REFERENCES "public"."creation_projects"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_rules" ADD CONSTRAINT "platform_rules_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_positioning_session_id_positioning_sessions_id_fk" FOREIGN KEY ("positioning_session_id") REFERENCES "public"."positioning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_retrieval_record_id_retrieval_records_id_fk" FOREIGN KEY ("retrieval_record_id") REFERENCES "public"."retrieval_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_report_user_owner_fk" FOREIGN KEY ("report_id","user_id") REFERENCES "public"."reports"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_report_guest_owner_fk" FOREIGN KEY ("report_id","guest_session_id") REFERENCES "public"."reports"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_session_user_owner_fk" FOREIGN KEY ("positioning_session_id","user_id") REFERENCES "public"."positioning_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_session_guest_owner_fk" FOREIGN KEY ("positioning_session_id","guest_session_id") REFERENCES "public"."positioning_sessions"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_sessions" ADD CONSTRAINT "positioning_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_sessions" ADD CONSTRAINT "positioning_sessions_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_records" ADD CONSTRAINT "retrieval_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_records" ADD CONSTRAINT "retrieval_records_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_retrieval_record_id_retrieval_records_id_fk" FOREIGN KEY ("retrieval_record_id") REFERENCES "public"."retrieval_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_report_user_owner_fk" FOREIGN KEY ("report_id","user_id") REFERENCES "public"."reports"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_report_guest_owner_fk" FOREIGN KEY ("report_id","guest_session_id") REFERENCES "public"."reports"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_user_owner_fk" FOREIGN KEY ("review_id","user_id") REFERENCES "public"."reviews"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_guest_owner_fk" FOREIGN KEY ("review_id","guest_session_id") REFERENCES "public"."reviews"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_report_id_reports_id_fk" FOREIGN KEY ("source_report_id") REFERENCES "public"."reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_report_user_owner_fk" FOREIGN KEY ("source_report_id","user_id") REFERENCES "public"."reports"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_report_guest_owner_fk" FOREIGN KEY ("source_report_id","guest_session_id") REFERENCES "public"."reports"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_source_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("source_guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_idx" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_converted_user_idx" ON "guest_sessions" USING btree ("converted_to_user_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_expires_at_idx" ON "guest_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "ai_runs_user_owner_idx" ON "ai_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_runs_guest_owner_idx" ON "ai_runs" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "content_plans_user_owner_idx" ON "content_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "content_plans_guest_owner_idx" ON "content_plans" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "content_plans_project_idx" ON "content_plans" USING btree ("creation_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_plans_project_version_idx" ON "content_plans" USING btree ("creation_project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "content_plans_report_version_idx" ON "content_plans" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "creation_projects_user_owner_idx" ON "creation_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creation_projects_guest_owner_idx" ON "creation_projects" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "creator_profiles_user_owner_idx" ON "creator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creator_profiles_guest_owner_idx" ON "creator_profiles" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_user_unique_idx" ON "creator_profiles" USING btree ("user_id") WHERE "creator_profiles"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_guest_unique_idx" ON "creator_profiles" USING btree ("guest_session_id") WHERE "creator_profiles"."guest_session_id" is not null;--> statement-breakpoint
CREATE INDEX "interview_messages_session_idx" ON "interview_messages" USING btree ("positioning_session_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_source_idx" ON "knowledge_items" USING btree ("knowledge_source_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_retrieval_idx" ON "knowledge_items" USING btree ("review_status","retrieval_scope");--> statement-breakpoint
CREATE INDEX "knowledge_items_search_idx" ON "knowledge_items" USING gin (to_tsvector('simple', "searchable_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_name_idx" ON "knowledge_sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "knowledge_sources_retrieval_idx" ON "knowledge_sources" USING btree ("review_status","retrieval_scope");--> statement-breakpoint
CREATE INDEX "material_references_user_owner_idx" ON "material_references" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "material_references_guest_owner_idx" ON "material_references" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_references_unique_idx" ON "material_references" USING btree ("material_id","creation_project_id");--> statement-breakpoint
CREATE INDEX "materials_user_owner_idx" ON "materials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "materials_guest_owner_idx" ON "materials" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "metric_snapshots_review_idx" ON "metric_snapshots" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "platform_accounts_user_owner_idx" ON "platform_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_accounts_guest_owner_idx" ON "platform_accounts" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_rules_identity_idx" ON "platform_rules" USING btree ("platform","rule_type","content_hash");--> statement-breakpoint
CREATE INDEX "platform_rules_platform_idx" ON "platform_rules" USING btree ("platform","enabled","review_status","retrieval_scope");--> statement-breakpoint
CREATE INDEX "positioning_reports_user_owner_idx" ON "positioning_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positioning_reports_guest_owner_idx" ON "positioning_reports" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "positioning_reports_session_idx" ON "positioning_reports" USING btree ("positioning_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positioning_reports_session_version_idx" ON "positioning_reports" USING btree ("positioning_session_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "positioning_reports_report_version_idx" ON "positioning_reports" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "positioning_sessions_user_owner_idx" ON "positioning_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positioning_sessions_guest_owner_idx" ON "positioning_sessions" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "product_events_user_owner_idx" ON "product_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "product_events_guest_owner_idx" ON "product_events" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "product_events_name_created_idx" ON "product_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_task_version_idx" ON "prompt_versions" USING btree ("task_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_one_active_per_task_idx" ON "prompt_versions" USING btree ("task_type") WHERE "prompt_versions"."enabled" = true;--> statement-breakpoint
CREATE INDEX "reports_user_owner_idx" ON "reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reports_guest_owner_idx" ON "reports" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "retrieval_records_user_owner_idx" ON "retrieval_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "retrieval_records_guest_owner_idx" ON "retrieval_records" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "review_reports_user_owner_idx" ON "review_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_reports_guest_owner_idx" ON "review_reports" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "review_reports_review_idx" ON "review_reports" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_review_version_idx" ON "review_reports" USING btree ("review_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_report_version_idx" ON "review_reports" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "reviews_user_owner_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reviews_guest_owner_idx" ON "reviews" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "tasks_user_owner_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_guest_owner_idx" ON "tasks" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "tasks_actor_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_settings_user_owner_idx" ON "user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_settings_guest_owner_idx" ON "user_settings" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_unique_idx" ON "user_settings" USING btree ("user_id") WHERE "user_settings"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_guest_unique_idx" ON "user_settings" USING btree ("guest_session_id") WHERE "user_settings"."guest_session_id" is not null;--> statement-breakpoint
-- Composite owner constraints are deferred so Task 3 can atomically transfer
-- an entire guest-owned graph to a verified user inside one transaction.
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_retrieval_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_retrieval_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_report_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_report_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_project_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_project_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_material_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_material_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_project_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_project_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_report_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_report_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_session_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_session_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_report_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_report_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_review_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_review_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tasks" ALTER CONSTRAINT "tasks_source_report_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tasks" ALTER CONSTRAINT "tasks_source_report_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;
