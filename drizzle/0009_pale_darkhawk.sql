ALTER TABLE "content_plans" ADD COLUMN "content_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "source_snapshot" jsonb DEFAULT '{"profileVersion":null,"materialIds":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_parent_version_fk" FOREIGN KEY ("report_id","parent_version") REFERENCES "public"."content_plans"("report_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_parent_before_child" CHECK ("content_plans"."parent_version" is null or "content_plans"."parent_version" < "content_plans"."version");
--> statement-breakpoint
ALTER TABLE "content_plans" ALTER CONSTRAINT "content_plans_parent_version_fk" DEFERRABLE INITIALLY DEFERRED;
