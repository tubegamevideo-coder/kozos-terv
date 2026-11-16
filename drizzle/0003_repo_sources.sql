CREATE TYPE "public"."repo_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
ALTER TYPE "public"."revision_kind" ADD VALUE 'sync';--> statement-breakpoint
CREATE TABLE "project_repo" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" "repo_provider" NOT NULL,
	"repo" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "section_source" (
	"section_id" text PRIMARY KEY NOT NULL,
	"provider" "repo_provider" NOT NULL,
	"repo" text NOT NULL,
	"path" text NOT NULL,
	"ref" text,
	"blob_sha" text NOT NULL,
	"web_url" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "project_repo" ADD CONSTRAINT "project_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repo" ADD CONSTRAINT "project_repo_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_source" ADD CONSTRAINT "section_source_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_source" ADD CONSTRAINT "section_source_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repo_live_uq" ON "project_repo" USING btree ("project_id","provider","repo") WHERE deleted_at is null;