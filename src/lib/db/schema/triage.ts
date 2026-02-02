import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
  integer,
} from "drizzle-orm/pg-core";

// Connector types for inbox items
export const connectorTypeEnum = pgEnum("connector_type", [
  "gmail",
  "slack",
  "linear",
  "granola",
  "manual",
]);

// Inbox item status
export const inboxStatusEnum = pgEnum("inbox_status", [
  "new",
  "archived",
  "snoozed",
  "actioned",
]);

// Priority levels
export const priorityEnum = pgEnum("priority", [
  "urgent",
  "high",
  "normal",
  "low",
]);

// Triage rule status
export const ruleStatusEnum = pgEnum("rule_status", ["active", "inactive"]);

// Inbox items: unified triage inbox
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connector: connectorTypeEnum("connector").notNull(),
    externalId: text("external_id"), // ID in source system (gmail message ID, slack ts, etc)

    // Core content
    sender: text("sender").notNull(), // email address, slack user, linear assignee
    senderName: text("sender_name"), // Display name
    senderAvatar: text("sender_avatar"), // Avatar URL
    subject: text("subject").notNull(),
    content: text("content").notNull(), // Main text content
    preview: text("preview"), // Short preview text

    // Raw data from connector
    rawPayload: jsonb("raw_payload"), // Original API response

    // Triage state
    status: inboxStatusEnum("status").default("new").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    priority: priorityEnum("priority").default("normal").notNull(),
    tags: text("tags").array().default([]).notNull(),

    // AI enrichment
    enrichment: jsonb("enrichment").$type<{
      summary?: string;
      suggestedPriority?: string;
      suggestedTags?: string[];
      linkedEntities?: Array<{
        id: string;
        name: string;
        type: string;
      }>;
      suggestedActions?: Array<{
        type: string;
        label: string;
        reason: string;
      }>;
      contextFromMemory?: string;
    }>(),

    // Timestamps
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(), // When the item was received in source
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("inbox_items_status_idx").on(table.status),
    index("inbox_items_connector_idx").on(table.connector),
    index("inbox_items_priority_idx").on(table.priority),
    index("inbox_items_received_at_idx").on(table.receivedAt),
  ]
);

// Triage rules: automated actions
export const triageRules = pgTable(
  "triage_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),

    // Trigger conditions
    trigger: jsonb("trigger").notNull().$type<{
      connector?: string; // Match specific connector
      sender?: string; // Email/user pattern (supports *)
      senderDomain?: string; // e.g. "@company.com"
      subjectContains?: string; // Keyword in subject
      contentContains?: string; // Keyword in content
      pattern?: string; // Regex pattern
    }>(),

    // Action to take
    action: jsonb("action").notNull().$type<{
      type: "archive" | "priority" | "tag" | "snooze";
      value?: string; // Priority level, tag name, snooze duration
    }>(),

    // Status and versioning
    status: ruleStatusEnum("status").default("active").notNull(),
    version: integer("version").default(1).notNull(),
    createdBy: text("created_by").default("user").notNull(), // 'user' | 'aurelius'

    // Stats
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("triage_rules_status_idx").on(table.status),
  ]
);

// Type exports
export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
export type TriageRule = typeof triageRules.$inferSelect;
export type NewTriageRule = typeof triageRules.$inferInsert;
