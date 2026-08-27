CREATE TYPE "public"."material_category" AS ENUM('inspiration', 'history_content');
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "category" "material_category";
--> statement-breakpoint
UPDATE "materials" SET "category" = 'inspiration' WHERE "category" IS NULL;
--> statement-breakpoint
ALTER TABLE "materials" ALTER COLUMN "category" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_client_id" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sort_order" integer;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "planned_date" date;
--> statement-breakpoint
UPDATE "tasks"
SET
  "source_client_id" = "tasks"."id"::text,
  "idempotency_key" = 'legacy:' || "tasks"."id"::text,
  "sort_order" = ranked."row_number" - 1,
  "planned_date" = COALESCE("planned_for"::date, "created_at"::date),
  "estimated_minutes" = GREATEST(5, LEAST(1440, COALESCE("estimated_minutes", 30))),
  "completion_criteria" = COALESCE(NULLIF(BTRIM("completion_criteria"), ''), '按任务步骤完成并记录结果')
FROM (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "source_report_id", "source_version"
    ORDER BY "created_at", "id"
  )::integer AS "row_number"
  FROM "tasks"
) AS ranked
WHERE "tasks"."id" = ranked."id";
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "source_client_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "sort_order" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "planned_date" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "estimated_minutes" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "completion_criteria" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "planned_for";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_numeric_ranges";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_numeric_ranges" CHECK (
  "estimated_minutes" BETWEEN 5 AND 1440
  AND "priority" BETWEEN 1 AND 3
  AND "sort_order" >= 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_source_identity_unique_idx" ON "tasks" USING btree (
  "source_report_id", "source_version", "source_client_id"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_idempotency_unique_idx" ON "tasks" USING btree (
  "user_id", "idempotency_key", "source_client_id"
) WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_guest_idempotency_unique_idx" ON "tasks" USING btree (
  "guest_session_id", "idempotency_key", "source_client_id"
) WHERE "guest_session_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "material_references" DROP CONSTRAINT "material_references_material_id_materials_id_fk";
--> statement-breakpoint
ALTER TABLE "material_references" DROP CONSTRAINT "material_references_material_user_owner_fk";
--> statement-breakpoint
ALTER TABLE "material_references" DROP CONSTRAINT "material_references_material_guest_owner_fk";
--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_user_owner_fk" FOREIGN KEY ("material_id", "user_id") REFERENCES "public"."materials"("id", "user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_material_guest_owner_fk" FOREIGN KEY ("material_id", "guest_session_id") REFERENCES "public"."materials"("id", "guest_session_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_material_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "material_references" ALTER CONSTRAINT "material_references_material_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;
