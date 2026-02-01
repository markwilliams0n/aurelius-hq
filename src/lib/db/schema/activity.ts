import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { actorEnum } from "./config";

export const eventTypeEnum = pgEnum("event_type", [
  "auth_login",
  "auth_logout",
  "config_created",
  "config_updated",
  "memory_created",
  "memory_updated",
  "memory_deleted",
  "triage_action",
  "task_created",
  "task_updated",
  "connector_sync",
  "system_error",
]);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: eventTypeEnum("event_type").notNull(),
  actor: actorEnum("actor").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
