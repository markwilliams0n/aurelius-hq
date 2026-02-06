import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const memoryEventTypeEnum = pgEnum("memory_event_type", [
  "recall",
  "extract",
  "save",
  "search",
  "reindex",
  "evaluate",
]);

export const memoryEventTriggerEnum = pgEnum("memory_event_trigger", [
  "chat",
  "heartbeat",
  "triage",
  "manual",
  "api",
]);

export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    eventType: memoryEventTypeEnum("event_type").notNull(),
    trigger: memoryEventTriggerEnum("trigger").notNull(),
    triggerId: text("trigger_id"),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    reasoning: jsonb("reasoning").$type<Record<string, unknown>>(),
    evaluation: jsonb("evaluation").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("memory_events_timestamp_idx").on(table.timestamp),
    index("memory_events_event_type_idx").on(table.eventType),
    index("memory_events_trigger_idx").on(table.trigger),
  ]
);

export type MemoryEvent = typeof memoryEvents.$inferSelect;
export type NewMemoryEvent = typeof memoryEvents.$inferInsert;
