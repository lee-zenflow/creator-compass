CREATE TABLE "runtime_heartbeats" (
	"component" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
