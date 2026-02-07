CREATE TYPE "public"."card_pattern" AS ENUM('approval', 'config', 'confirmation', 'info');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('pending', 'confirmed', 'dismissed', 'error');--> statement-breakpoint
CREATE TABLE "action_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"conversation_id" uuid,
	"pattern" "card_pattern" NOT NULL,
	"status" "card_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"handler" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_cards" ADD CONSTRAINT "action_cards_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_cards_conversation_idx" ON "action_cards" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "action_cards_status_idx" ON "action_cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "action_cards_message_idx" ON "action_cards" USING btree ("message_id");