CREATE TABLE "creator_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"creator_profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parent_version" integer,
	"source_report_id" uuid,
	"source_report_version" integer,
	"source" "generation_mode" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profile_versions_exactly_one_actor" CHECK (num_nonnulls("creator_profile_versions"."user_id", "creator_profile_versions"."guest_session_id") = 1),
	CONSTRAINT "creator_profile_versions_version_positive" CHECK ("creator_profile_versions"."version" > 0),
	CONSTRAINT "creator_profile_versions_parent_before_child" CHECK ("creator_profile_versions"."parent_version" is null or "creator_profile_versions"."parent_version" < "creator_profile_versions"."version")
);
--> statement-breakpoint
ALTER TABLE "interview_messages" ADD COLUMN "client_message_id" text;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ADD CONSTRAINT "creator_profile_versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ADD CONSTRAINT "creator_profile_versions_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ADD CONSTRAINT "creator_profile_versions_creator_profile_id_creator_profiles_id_fk" FOREIGN KEY ("creator_profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_profile_versions_user_owner_idx" ON "creator_profile_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "creator_profile_versions_guest_owner_idx" ON "creator_profile_versions" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profile_versions_profile_version_idx" ON "creator_profile_versions" USING btree ("creator_profile_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_positioning_processing_unique_idx" ON "ai_runs" USING btree ("positioning_session_id") WHERE "ai_runs"."positioning_session_id" is not null and "ai_runs"."status" = 'processing';--> statement-breakpoint
UPDATE "interview_messages" SET "client_message_id" = 'legacy:' || "id"::text WHERE "sender" = 'user' AND "client_message_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_messages_session_client_unique_idx" ON "interview_messages" USING btree ("positioning_session_id","client_message_id") WHERE "interview_messages"."client_message_id" is not null;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_user_client_id_required" CHECK ("interview_messages"."sender" <> 'user' or "interview_messages"."client_message_id" is not null);--> statement-breakpoint
ALTER TABLE "positioning_sessions" ADD CONSTRAINT "positioning_sessions_current_step_range" CHECK ("positioning_sessions"."current_step" between 0 and 10);--> statement-breakpoint
INSERT INTO "creator_profile_versions" (
  "user_id", "guest_session_id", "creator_profile_id", "version", "parent_version",
  "source_report_id", "source_report_version", "source", "snapshot", "created_at", "updated_at"
)
SELECT
  "user_id", "guest_session_id", "id", "version", NULL,
  NULL, NULL, 'manual'::"generation_mode",
  jsonb_build_object(
    'profileDimensions', "profile_dimensions",
    'currentPositioning', "current_positioning",
    'targetAudience', "target_audience",
    'contentDirection', "content_direction",
    'platformPreferences', "platform_preferences",
    'materialNotes', "material_notes"
  ),
  "created_at", "updated_at"
FROM "creator_profiles"
ON CONFLICT ("creator_profile_id", "version") DO NOTHING;
