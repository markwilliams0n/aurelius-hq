import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
  customType,
} from "drizzle-orm/pg-core";

// Custom vector type for pgvector
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => parseFloat(v));
  },
});

// Enums
export const entityTypeEnum = pgEnum("entity_type", [
  "person",
  "project",
  "topic",
  "company",
  "team",
  "document",
]);

export const factCategoryEnum = pgEnum("fact_category", [
  "preference",
  "relationship",
  "status",
  "context",
  "milestone",
]);

export const factStatusEnum = pgEnum("fact_status", ["active", "superseded"]);

export const factSourceEnum = pgEnum("fact_source", [
  "chat",
  "document",
  "manual",
]);

// Entities: people, projects, topics, etc.
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: entityTypeEnum("type").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    summaryEmbedding: vector("summary_embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("entities_type_idx").on(table.type),
    index("entities_name_idx").on(table.name),
  ]
);

// Facts: atomic pieces of knowledge linked to entities
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    category: factCategoryEnum("category"),
    status: factStatusEnum("status").default("active").notNull(),
    supersededBy: uuid("superseded_by").references((): any => facts.id),
    sourceType: factSourceEnum("source_type").default("chat").notNull(),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("facts_entity_idx").on(table.entityId),
    index("facts_status_idx").on(table.status),
  ]
);

// Conversations: chat history
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  messages: jsonb("messages").notNull().$type<
    Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: string;
      memories?: Array<{ factId: string; content: string }>;
    }>
  >(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Type exports
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
