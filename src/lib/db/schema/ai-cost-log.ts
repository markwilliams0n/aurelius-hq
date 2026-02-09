import { pgTable, text, timestamp, uuid, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { inboxItems } from "./triage";

export const aiCostLog = pgTable("ai_cost_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  itemId: uuid("item_id").references(() => inboxItems.id, { onDelete: "set null" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AiCostLogEntry = typeof aiCostLog.$inferSelect;
export type NewAiCostLogEntry = typeof aiCostLog.$inferInsert;
