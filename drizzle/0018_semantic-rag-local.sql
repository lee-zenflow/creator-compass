ALTER TABLE "knowledge_items" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "embedding_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "embedding_version" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "default_platform" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "default_content_type" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "default_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "allow_ai_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "embedding_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "embedding_version" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_embedding_512" CHECK ("knowledge_items"."embedding" is null or case when jsonb_typeof("knowledge_items"."embedding") = 'array' then jsonb_array_length("knowledge_items"."embedding") = 512 else false end);--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_embedding_status_valid" CHECK ("knowledge_items"."embedding_status" in ('pending', 'ready', 'failed', 'not_requested'));--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_embedding_status_valid" CHECK ("knowledge_sources"."embedding_status" in ('pending', 'ready', 'failed', 'not_requested'));