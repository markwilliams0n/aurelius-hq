import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { inboxItems } from "./triage";

// Task assignee type
export const assigneeTypeEnum = pgEnum("assignee_type", [
  "self",
  "other",
  "unknown",
]);

// Suggested task status
export const taskStatusEnum = pgEnum("task_status", [
  "suggested",
  "accepted",
  "dismissed",
]);

// Confidence level for extraction
export const confidenceEnum = pgEnum("confidence_level", [
  "high",
  "medium",
  "low",
]);

// Suggested tasks extracted from triage items
export const suggestedTasks = pgTable(
  "suggested_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Link to source triage item
    sourceItemId: uuid("source_item_id").references(() => inboxItems.id, {
      onDelete: "cascade",
    }),

    // Task content
    description: text("description").notNull(),
    assignee: text("assignee"), // person name or null
    assigneeType: assigneeTypeEnum("assignee_type").default("unknown").notNull(),
    dueDate: text("due_date"), // extracted due date if mentioned

    // Status
    status: taskStatusEnum("status").default("suggested").notNull(),

    // Metadata
    confidence: confidenceEnum("confidence").default("medium").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }), // when accepted/dismissed
  },
  (table) => [
    index("suggested_tasks_source_item_idx").on(table.sourceItemId),
    index("suggested_tasks_status_idx").on(table.status),
    index("suggested_tasks_assignee_type_idx").on(table.assigneeType),
  ]
);

// Type exports
export type SuggestedTask = typeof suggestedTasks.$inferSelect;
export type NewSuggestedTask = typeof suggestedTasks.$inferInsert;
