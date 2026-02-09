CREATE TYPE "public"."rule_source" AS ENUM('user_chat', 'user_settings', 'daily_learning', 'override');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('structured', 'guidance');--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'capability:code';--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'capability:gmail';--> statement-breakpoint
ALTER TYPE "public"."card_pattern" ADD VALUE 'vault';--> statement-breakpoint
ALTER TYPE "public"."card_pattern" ADD VALUE 'code';--> statement-breakpoint
ALTER TYPE "public"."card_pattern" ADD VALUE 'batch';--> statement-breakpoint
CREATE TABLE "ai_cost_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"item_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" numeric(10, 6),
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_rules" ALTER COLUMN "trigger" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_rules" ALTER COLUMN "action" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD COLUMN "type" "rule_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD COLUMN "guidance" text;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD COLUMN "source" "rule_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_cost_log" ADD CONSTRAINT "ai_cost_log_item_id_inbox_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inbox_items"("id") ON DELETE set null ON UPDATE no action;