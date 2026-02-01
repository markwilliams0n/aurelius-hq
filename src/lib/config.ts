import { db } from "@/lib/db";
import { configs, configKeyEnum } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

type ConfigKey = (typeof configKeyEnum.enumValues)[number];

export async function getConfig(key: ConfigKey) {
  const [config] = await db
    .select()
    .from(configs)
    .where(eq(configs.key, key))
    .orderBy(desc(configs.version))
    .limit(1);

  return config ?? null;
}

export async function getConfigHistory(key: ConfigKey, limit = 10) {
  return db
    .select()
    .from(configs)
    .where(eq(configs.key, key))
    .orderBy(desc(configs.version))
    .limit(limit);
}

export async function updateConfig(
  key: ConfigKey,
  content: string,
  createdBy: "user" | "aurelius"
) {
  const current = await getConfig(key);
  const nextVersion = (current?.version ?? 0) + 1;

  const [newConfig] = await db
    .insert(configs)
    .values({
      key,
      content,
      version: nextVersion,
      createdBy,
    })
    .returning();

  return newConfig;
}
