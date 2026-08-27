CREATE TABLE "deepseek_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"envelope_version" integer NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"last_four" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"tested_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deepseek_credentials_envelope_version_positive" CHECK ("deepseek_credentials"."envelope_version" > 0),
	CONSTRAINT "deepseek_credentials_last_four_length" CHECK (char_length("deepseek_credentials"."last_four") = 4)
);
--> statement-breakpoint
CREATE TABLE "local_instance" (
	"singleton_key" text PRIMARY KEY DEFAULT 'owner' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_instance_singleton_key" CHECK ("local_instance"."singleton_key" = 'owner')
);
--> statement-breakpoint
CREATE TABLE "owner_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_records_token_counts_nonnegative" CHECK ("ai_usage_records"."input_tokens" >= 0 and "ai_usage_records"."output_tokens" >= 0),
	CONSTRAINT "ai_usage_records_model_supported" CHECK ("ai_usage_records"."model" = 'deepseek-v4-flash')
);
--> statement-breakpoint
ALTER TABLE "deepseek_credentials" ADD CONSTRAINT "deepseek_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_instance" ADD CONSTRAINT "local_instance_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_recovery_codes" ADD CONSTRAINT "owner_recovery_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_run_user_owner_fk" FOREIGN KEY ("ai_run_id","user_id") REFERENCES "public"."ai_runs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ALTER CONSTRAINT "ai_usage_records_run_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "local_instance_owner_unique_idx" ON "local_instance" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_recovery_codes_hash_unique_idx" ON "owner_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "owner_recovery_codes_user_available_idx" ON "owner_recovery_codes" USING btree ("user_id","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_records_run_unique_idx" ON "ai_usage_records" USING btree ("ai_run_id");--> statement-breakpoint
CREATE INDEX "ai_usage_records_user_created_idx" ON "ai_usage_records" USING btree ("user_id","created_at");
