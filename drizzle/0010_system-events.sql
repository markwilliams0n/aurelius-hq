CREATE TYPE "public"."system_event_type" AS ENUM('tool_call', 'connector_sync', 'config_change', 'capability_use');--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "system_event_type" NOT NULL,
	"source" text NOT NULL,
	"target" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
