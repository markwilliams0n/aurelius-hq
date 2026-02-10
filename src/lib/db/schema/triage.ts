import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// Rule type: structured (deterministic) vs guidance (natural language for AI)
export const ruleTypeEnum = pgEnum("rule_type", ["structured", "guidance"]);

// Rule source: where the rule came from
export const ruleSourceEnum = pgEnum("rule_source", [
  "user_chat",
  "user_settings",
  "daily_learning",
  "override",
]);

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
      // Granola meeting specific
      attendees?: string;
      meetingTime?: string;
      topics?: string[];
      actionItems?: Array<{
        description: string;
        assignee?: string;
        dueDate?: string;
      }>;
      // Action needed tracking
      actionNeededDate?: string;
      // Gmail-specific sender tags
      senderTags?: string[];
      isSuspicious?: boolean;
      phishingIndicators?: string[];
      // Recipients (Gmail-specific)
      recipients?: {
        to: Array<{ email: string; name?: string }>;
        cc: Array<{ email: string; name?: string }>;
        internal: Array<{ email: string; name?: string }>;
      };
      // Extracted memory ready for review
      extractedMemory?: {
        entities?: Array<{
          name: string;
          type: string;
          role?: string;
          facts: string[];
        }>;
        facts?: Array<{
          content: string;
          category: string;
          entityName?: string;
          confidence: string;
        }>;
        actionItems?: Array<{
          description: string;
          assignee?: string;
          dueDate?: string;
        }>;
        summary?: string;
        topics?: string[];
      };
    }>(),

    // Classification from pre-processing pipeline
    classification: jsonb("classification").$type<{
      batchCardId: string | null;
      batchType: string | null;
      tier: "rule" | "ollama" | "kimi";
      confidence: number;
      reason: string;
      classifiedAt: string;
      ruleId?: string;
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
    uniqueIndex("inbox_items_connector_external_id_idx")
      .on(table.connector, table.externalId)
      .where(sql`external_id IS NOT NULL`),
  ]
);

// Triage rules: automated actions
export const triageRules = pgTable(
  "triage_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),

    // Rule type
    type: ruleTypeEnum("type").notNull(),

    // Structured rule: deterministic matching
    trigger: jsonb("trigger").$type<{
      connector?: string;
      sender?: string;
      senderDomain?: string;
      subjectContains?: string;
      contentContains?: string;
      pattern?: string;
    }>(),

    // Structured rule: what batch to put it in
    action: jsonb("action").$type<{
      type: "batch";
      batchType: string;
      label?: string;
    }>(),

    // Guidance note: natural language for AI context
    guidance: text("guidance"),

    // Metadata
    status: ruleStatusEnum("status").default("active").notNull(),
    source: ruleSourceEnum("source").notNull(),
    order: integer("order").default(0),
    version: integer("version").default(1).notNull(),
    createdBy: text("created_by").default("user").notNull(),

    // Stats
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("triage_rules_status_idx").on(table.status)],
);

// Type exports
export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
export type TriageRule = typeof triageRules.$inferSelect;
export type NewTriageRule = typeof triageRules.$inferInsert;
