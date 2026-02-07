import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { conversations } from "./memory";

// Content pattern — determines UI layout and interaction model
export const cardPatternEnum = pgEnum("card_pattern", [
  "approval",
  "config",
  "confirmation",
  "info",
]);

// Card lifecycle status
export const cardStatusEnum = pgEnum("card_status", [
  "pending",
  "confirmed",
  "dismissed",
  "error",
]);

// Action cards — generic interactive containers in chat
export const actionCards = pgTable(
  "action_cards",
  {
    id: text("id").primaryKey(), // card-{timestamp}-{random}

    // Chat context
    messageId: text("message_id"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),

    // Card definition
    pattern: cardPatternEnum("pattern").notNull(),
    status: cardStatusEnum("status").default("pending").notNull(),
    title: text("title").notNull(),
    data: jsonb("data").notNull().$type<Record<string, unknown>>(),

    // Execution
    handler: text("handler"), // e.g. "slack:send-message", null for display-only
    result: jsonb("result").$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("action_cards_conversation_idx").on(table.conversationId),
    index("action_cards_status_idx").on(table.status),
    index("action_cards_message_idx").on(table.messageId),
  ]
);

// Type exports
export type ActionCard = typeof actionCards.$inferSelect;
export type NewActionCard = typeof actionCards.$inferInsert;
