CREATE TABLE "knowledge_source_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"previous_review_status" "review_status" NOT NULL,
	"new_review_status" "review_status" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_source_review_events_new_status_valid" CHECK ("knowledge_source_review_events"."new_review_status" in ('approved', 'rejected')),
	CONSTRAINT "knowledge_source_review_events_rejection_reason_required" CHECK ("knowledge_source_review_events"."new_review_status" <> 'rejected' or (nullif(btrim("knowledge_source_review_events"."reason"), '') is not null))
);
--> statement-breakpoint
ALTER TABLE "knowledge_source_review_events" ADD CONSTRAINT "knowledge_source_review_events_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source_review_events" ADD CONSTRAINT "knowledge_source_review_events_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_source_review_events_source_created_idx" ON "knowledge_source_review_events" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_source_review_events_reviewer_idx" ON "knowledge_source_review_events" USING btree ("reviewer_user_id");