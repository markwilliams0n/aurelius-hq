import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

export const systemEventTypeEnum = pgEnum("system_event_type", [
  "tool_call",
  "connector_sync",
  "config_change",
  "capability_use",
]);

export const systemEvents = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: systemEventTypeEnum("event_type").notNull(),
  source: text("source").notNull(), // e.g. 'connector:slack', 'capability:tasks'
  target: text("target"), // optional — what it connected to
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
