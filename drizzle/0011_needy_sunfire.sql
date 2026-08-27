ALTER TABLE "platform_accounts" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "platform_account_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_id_user_unique_idx" ON "platform_accounts" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_id_guest_unique_idx" ON "platform_accounts" USING btree ("id","guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_active_user_idx" ON "platform_accounts" USING btree ("user_id") WHERE "platform_accounts"."user_id" is not null and "platform_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_active_guest_idx" ON "platform_accounts" USING btree ("guest_session_id") WHERE "platform_accounts"."guest_session_id" is not null and "platform_accounts"."is_active" = true;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_platform_account_user_owner_fk" FOREIGN KEY ("platform_account_id","user_id") REFERENCES "public"."platform_accounts"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_platform_account_guest_owner_fk" FOREIGN KEY ("platform_account_id","guest_session_id") REFERENCES "public"."platform_accounts"("id","guest_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ALTER CONSTRAINT "reviews_platform_account_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "reviews" ALTER CONSTRAINT "reviews_platform_account_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;
