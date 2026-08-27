CREATE UNIQUE INDEX "creator_profiles_id_user_unique_idx" ON "creator_profiles" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_id_guest_unique_idx" ON "creator_profiles" USING btree ("id","guest_session_id");--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ADD CONSTRAINT "creator_profile_versions_profile_user_owner_fk" FOREIGN KEY ("creator_profile_id","user_id") REFERENCES "public"."creator_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ALTER CONSTRAINT "creator_profile_versions_profile_user_owner_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ADD CONSTRAINT "creator_profile_versions_profile_guest_owner_fk" FOREIGN KEY ("creator_profile_id","guest_session_id") REFERENCES "public"."creator_profiles"("id","guest_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile_versions" ALTER CONSTRAINT "creator_profile_versions_profile_guest_owner_fk" DEFERRABLE INITIALLY DEFERRED;
