ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_parent_version_fk" FOREIGN KEY ("report_id","parent_version") REFERENCES "public"."review_reports"("report_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_parent_before_child" CHECK ("review_reports"."parent_version" is null or "review_reports"."parent_version" < "review_reports"."version");
--> statement-breakpoint
ALTER TABLE "review_reports" ALTER CONSTRAINT "review_reports_parent_version_fk" DEFERRABLE INITIALLY DEFERRED;
