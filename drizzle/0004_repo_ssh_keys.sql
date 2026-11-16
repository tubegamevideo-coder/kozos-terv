ALTER TABLE "project_repo" ADD COLUMN "ssh_public_key" text;--> statement-breakpoint
ALTER TABLE "project_repo" ADD COLUMN "ssh_fingerprint" text;--> statement-breakpoint
ALTER TABLE "project_repo" ADD COLUMN "ssh_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_repo" ADD COLUMN "ssh_verified_at" timestamp with time zone;