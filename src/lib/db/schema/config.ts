import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

export const configKeyEnum = pgEnum("config_key", ["soul", "system_prompt", "agents", "processes", "capability:tasks", "capability:config", "prompt:email_draft", "capability:slack", "slack:directory", "capability:vault", "capability:code", "capability:gmail", "capability:browser", "sync:gmail", "sync:granola", "sync:linear", "sync:slack"]);
export const actorEnum = pgEnum("actor", ["system", "user", "aurelius"]);
export const pendingStatusEnum = pgEnum("pending_status", ["pending", "approved", "rejected"]);

export const configs = pgTable("configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: configKeyEnum("key").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  createdBy: actorEnum("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.key, table.version),
]);

// Pending config changes proposed by the agent
export const pendingConfigChanges = pgTable("pending_config_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: configKeyEnum("key").notNull(),
  currentContent: text("current_content"), // null if creating new
  proposedContent: text("proposed_content").notNull(),
  reason: text("reason").notNull(), // Why the agent is proposing this change
  status: pendingStatusEnum("status").notNull().default("pending"),
  conversationId: uuid("conversation_id"), // Which conversation this was proposed in
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
