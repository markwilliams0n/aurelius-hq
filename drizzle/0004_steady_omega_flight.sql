CREATE TYPE "public"."connector_type" AS ENUM('gmail', 'slack', 'linear', 'manual');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('new', 'archived', 'snoozed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" "connector_type" NOT NULL,
	"external_id" text,
	"sender" text NOT NULL,
	"sender_name" text,
	"sender_avatar" text,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"preview" text,
	"raw_payload" jsonb,
	"status" "inbox_status" DEFAULT 'new' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"enrichment" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"status" "rule_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT 'user' NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inbox_items_connector_idx" ON "inbox_items" USING btree ("connector");--> statement-breakpoint
CREATE INDEX "inbox_items_priority_idx" ON "inbox_items" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "inbox_items_received_at_idx" ON "inbox_items" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "triage_rules_status_idx" ON "triage_rules" USING btree ("status");