ALTER TABLE "ai_runs" ADD COLUMN "positioning_session_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "creation_project_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "ai_runs" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_positioning_session_id_positioning_sessions_id_fk" FOREIGN KEY ("positioning_session_id") REFERENCES "public"."positioning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_creation_project_id_creation_projects_id_fk" FOREIGN KEY ("creation_project_id") REFERENCES "public"."creation_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_positioning_user_owner_fk" FOREIGN KEY ("positioning_session_id","user_id") REFERENCES "public"."positioning_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_positioning_guest_owner_fk" FOREIGN KEY ("positioning_session_id","guest_session_id") REFERENCES "public"."positioning_sessions"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_creation_user_owner_fk" FOREIGN KEY ("creation_project_id","user_id") REFERENCES "public"."creation_projects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_creation_guest_owner_fk" FOREIGN KEY ("creation_project_id","guest_session_id") REFERENCES "public"."creation_projects"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_review_user_owner_fk" FOREIGN KEY ("review_id","user_id") REFERENCES "public"."reviews"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_review_guest_owner_fk" FOREIGN KEY ("review_id","guest_session_id") REFERENCES "public"."reviews"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_id_user_unique_idx" ON "ai_runs" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_id_guest_unique_idx" ON "ai_runs" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_user_idempotency_unique_idx" ON "ai_runs" USING btree ("user_id","task_type","idempotency_key") WHERE "ai_runs"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_guest_idempotency_unique_idx" ON "ai_runs" USING btree ("guest_session_id","task_type","idempotency_key") WHERE "ai_runs"."guest_session_id" is not null;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_ai_run_user_owner_fk" FOREIGN KEY ("ai_run_id","user_id") REFERENCES "public"."ai_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_ai_run_guest_owner_fk" FOREIGN KEY ("ai_run_id","guest_session_id") REFERENCES "public"."ai_runs"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_retrieval_user_owner_fk" FOREIGN KEY ("retrieval_record_id","user_id") REFERENCES "public"."retrieval_records"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_retrieval_guest_owner_fk" FOREIGN KEY ("retrieval_record_id","guest_session_id") REFERENCES "public"."retrieval_records"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_ai_run_user_owner_fk" FOREIGN KEY ("ai_run_id","user_id") REFERENCES "public"."ai_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_ai_run_guest_owner_fk" FOREIGN KEY ("ai_run_id","guest_session_id") REFERENCES "public"."ai_runs"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_retrieval_user_owner_fk" FOREIGN KEY ("retrieval_record_id","user_id") REFERENCES "public"."retrieval_records"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positioning_reports" ADD CONSTRAINT "positioning_reports_retrieval_guest_owner_fk" FOREIGN KEY ("retrieval_record_id","guest_session_id") REFERENCES "public"."retrieval_records"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_ai_run_user_owner_fk" FOREIGN KEY ("ai_run_id","user_id") REFERENCES "public"."ai_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_ai_run_guest_owner_fk" FOREIGN KEY ("ai_run_id","guest_session_id") REFERENCES "public"."ai_runs"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_retrieval_user_owner_fk" FOREIGN KEY ("retrieval_record_id","user_id") REFERENCES "public"."retrieval_records"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_retrieval_guest_owner_fk" FOREIGN KEY ("retrieval_record_id","guest_session_id") REFERENCES "public"."retrieval_records"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_task_subject_match" CHECK ((
  "ai_runs"."task_type" in ('profile_extract', 'positioning_report')
  and "ai_runs"."positioning_session_id" is not null
  and "ai_runs"."creation_project_id" is null
  and "ai_runs"."review_id" is null
) or (
  "ai_runs"."task_type" = 'content_plan'
  and "ai_runs"."positioning_session_id" is null
  and "ai_runs"."creation_project_id" is not null
  and "ai_runs"."review_id" is null
) or (
  "ai_runs"."task_type" = 'review_report'
  and "ai_runs"."positioning_session_id" is null
  and "ai_runs"."creation_project_id" is null
  and "ai_runs"."review_id" is not null
)) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_positioning_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_positioning_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_creation_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_creation_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_review_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER CONSTRAINT "ai_runs_review_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_ai_run_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_ai_run_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_retrieval_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_retrieval_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_ai_run_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_ai_run_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_retrieval_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "positioning_reports" ALTER CONSTRAINT "positioning_reports_retrieval_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_ai_run_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_ai_run_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_retrieval_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_retrieval_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;
