ALTER TABLE "guest_sessions" ALTER COLUMN "ai_quota_limit" SET DEFAULT 12;--> statement-breakpoint
UPDATE "guest_sessions" SET "ai_quota_limit" = 12 WHERE "ai_quota_limit" = 5;
