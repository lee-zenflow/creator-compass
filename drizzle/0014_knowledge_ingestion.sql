CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "knowledge_ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"input_kind" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"safe_failure_detail" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_ingestion_jobs_input_kind_valid" CHECK ("knowledge_ingestion_jobs"."input_kind" in ('url', 'file', 'text')),
	CONSTRAINT "knowledge_ingestion_jobs_status_valid" CHECK ("knowledge_ingestion_jobs"."status" in ('queued', 'fetching', 'parsing', 'tagging', 'pending_review', 'failed')),
	CONSTRAINT "knowledge_ingestion_jobs_attempt_nonnegative" CHECK ("knowledge_ingestion_jobs"."attempt" >= 0)
);
--> statement-breakpoint
DROP INDEX "knowledge_sources_name_idx";--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "chunk_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "char_start" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "char_end" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "original_mime" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "fetch_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "license_note" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_ingestion_jobs" ADD CONSTRAINT "knowledge_ingestion_jobs_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ingestion_jobs" ADD CONSTRAINT "knowledge_ingestion_jobs_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_jobs_status_idx" ON "knowledge_ingestion_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_items_search_trgm_idx" ON "knowledge_items" USING gin ("searchable_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "knowledge_sources_type_hash_idx" ON "knowledge_sources" USING btree ("source_type","content_hash");--> statement-breakpoint
CREATE INDEX "knowledge_sources_name_idx" ON "knowledge_sources" USING btree ("name");--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_chunk_index_nonnegative" CHECK ("knowledge_items"."chunk_index" >= 0);--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_char_range_valid" CHECK ("knowledge_items"."char_start" >= 0 and "knowledge_items"."char_end" >= "knowledge_items"."char_start");--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_fetch_status_valid" CHECK ("knowledge_sources"."fetch_status" in ('pending', 'fetched', 'failed'));
