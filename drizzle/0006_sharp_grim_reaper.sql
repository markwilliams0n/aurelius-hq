CREATE TYPE "public"."memory_event_trigger" AS ENUM('chat', 'heartbeat', 'triage', 'manual', 'api');--> statement-breakpoint
CREATE TYPE "public"."memory_event_type" AS ENUM('recall', 'extract', 'save', 'search', 'reindex', 'evaluate');--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'heartbeat_run' BEFORE 'system_error';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'synthesis_run' BEFORE 'system_error';--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" "memory_event_type" NOT NULL,
	"trigger" "memory_event_trigger" NOT NULL,
	"trigger_id" text,
	"summary" text NOT NULL,
	"payload" jsonb,
	"reasoning" jsonb,
	"evaluation" jsonb,
	"duration_ms" integer,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "memory_events_timestamp_idx" ON "memory_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "memory_events_event_type_idx" ON "memory_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "memory_events_trigger_idx" ON "memory_events" USING btree ("trigger");