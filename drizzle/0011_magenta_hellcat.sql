CREATE TYPE "public"."supermemory_status" AS ENUM('none', 'pending', 'sent');--> statement-breakpoint
CREATE TYPE "public"."vault_item_type" AS ENUM('document', 'fact', 'credential', 'reference');--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'capability:vault';--> statement-breakpoint
ALTER TYPE "public"."card_pattern" ADD VALUE 'vault';--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "vault_item_type" NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"file_path" text,
	"file_name" text,
	"content_type" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source_url" text,
	"supermemory_status" "supermemory_status" DEFAULT 'none' NOT NULL,
	"supermemory_level" text,
	"supermemory_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vault_items_tags_idx" ON "vault_items" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "vault_items_created_idx" ON "vault_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX idx_vault_items_search ON "vault_items" USING GIN (to_tsvector('english', "title" || ' ' || COALESCE("content", '')));