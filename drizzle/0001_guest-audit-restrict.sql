ALTER TABLE "guest_sessions" DROP CONSTRAINT "guest_sessions_converted_to_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_converted_to_user_id_user_id_fk" FOREIGN KEY ("converted_to_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;