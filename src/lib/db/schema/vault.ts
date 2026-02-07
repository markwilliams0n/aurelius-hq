import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const vaultItemTypeEnum = pgEnum("vault_item_type", [
  "document",
  "fact",
  "credential",
  "reference",
]);

export const supermemoryStatusEnum = pgEnum("supermemory_status", [
  "none",
  "pending",
  "sent",
]);

export const vaultItems = pgTable(
  "vault_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: vaultItemTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: text("content"), // searchable text — populated when available
    filePath: text("file_path"), // local filesystem path for binary files
    fileName: text("file_name"), // original filename
    contentType: text("content_type"), // MIME type
    sensitive: boolean("sensitive").default(false).notNull(),
    tags: text("tags").array().default([]).notNull(),
    sourceUrl: text("source_url"),

    // SuperMemory sync tracking
    supermemoryStatus: supermemoryStatusEnum("supermemory_status")
      .default("none")
      .notNull(),
    supermemoryLevel: text("supermemory_level"), // 'short' | 'medium' | 'detailed' | 'full'
    supermemorySummary: text("supermemory_summary"), // what was sent

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("vault_items_tags_idx").using("gin", table.tags),
    index("vault_items_created_idx").on(table.createdAt),
    // NOTE: Full-text search GIN index (idx_vault_items_search) is defined
    // manually in migration SQL — Drizzle cannot express to_tsvector() indexes.
  ]
);

export type VaultItem = typeof vaultItems.$inferSelect;
export type NewVaultItem = typeof vaultItems.$inferInsert;
