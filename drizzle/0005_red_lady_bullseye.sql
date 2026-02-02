CREATE TYPE "public"."assignee_type" AS ENUM('self', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('suggested', 'accepted', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."connector_type" ADD VALUE 'granola' BEFORE 'manual';--> statement-breakpoint
CREATE TABLE "suggested_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_item_id" uuid,
	"description" text NOT NULL,
	"assignee" text,
	"assignee_type" "assignee_type" DEFAULT 'unknown' NOT NULL,
	"due_date" text,
	"status" "task_status" DEFAULT 'suggested' NOT NULL,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "suggested_tasks" ADD CONSTRAINT "suggested_tasks_source_item_id_inbox_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggested_tasks_source_item_idx" ON "suggested_tasks" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "suggested_tasks_status_idx" ON "suggested_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "suggested_tasks_assignee_type_idx" ON "suggested_tasks" USING btree ("assignee_type");