CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('person', 'project', 'topic', 'company', 'team', 'document');--> statement-breakpoint
CREATE TYPE "public"."fact_category" AS ENUM('preference', 'relationship', 'status', 'context', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('chat', 'document', 'manual');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"summary_embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"category" "fact_category",
	"status" "fact_status" DEFAULT 'active' NOT NULL,
	"superseded_by" uuid,
	"source_type" "fact_source" DEFAULT 'chat' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_superseded_by_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_type_idx" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entities_name_idx" ON "entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "facts_entity_idx" ON "facts" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "facts_status_idx" ON "facts" USING btree ("status");