import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

export const configKeyEnum = pgEnum("config_key", ["soul", "agents", "processes"]);
export const actorEnum = pgEnum("actor", ["system", "user", "aurelius"]);

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
