import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const readingItemSourceEnum = pgEnum("reading_item_source", [
  "x-bookmark",
  "manual",
]);

export const readingItemStatusEnum = pgEnum("reading_item_status", [
  "unread",
  "read",
  "archived",
]);

export const readingList = pgTable(
  "reading_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: readingItemSourceEnum("source").notNull(),
    sourceId: text("source_id"),
    url: text("url"),
    title: text("title"),
    content: text("content"),
    summary: text("summary"),
    tags: text("tags").array().default([]),
    rawPayload: jsonb("raw_payload"),
    status: readingItemStatusEnum("status").default("unread").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reading_list_status_idx").on(table.status),
    index("reading_list_source_idx").on(table.source),
    index("reading_list_source_id_idx").on(table.sourceId),
  ]
);

export type ReadingListItem = typeof readingList.$inferSelect;
export type NewReadingListItem = typeof readingList.$inferInsert;
