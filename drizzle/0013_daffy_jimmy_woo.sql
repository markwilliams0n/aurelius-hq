CREATE TYPE "public"."reading_item_source" AS ENUM('x-bookmark', 'manual');--> statement-breakpoint
CREATE TYPE "public"."reading_item_status" AS ENUM('unread', 'read', 'archived');--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'capability:browser';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'sync:gmail';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'sync:granola';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'sync:linear';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'sync:slack';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'capability:code-agent';--> statement-breakpoint
CREATE TABLE "reading_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "reading_item_source" NOT NULL,
	"source_id" text,
	"url" text,
	"title" text,
	"content" text,
	"summary" text,
	"tags" text[] DEFAULT '{}',
	"raw_payload" jsonb,
	"status" "reading_item_status" DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_rules" ADD COLUMN "order" integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX "reading_list_status_idx" ON "reading_list" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reading_list_source_idx" ON "reading_list" USING btree ("source");--> statement-breakpoint
CREATE INDEX "reading_list_source_id_idx" ON "reading_list" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_connector_external_id_idx" ON "inbox_items" USING btree ("connector","external_id") WHERE external_id IS NOT NULL;