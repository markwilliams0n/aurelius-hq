CREATE TYPE "public"."pending_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."config_key" ADD VALUE 'system_prompt' BEFORE 'agents';--> statement-breakpoint
CREATE TABLE "pending_config_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "config_key" NOT NULL,
	"current_content" text,
	"proposed_content" text NOT NULL,
	"reason" text NOT NULL,
	"status" "pending_status" DEFAULT 'pending' NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
