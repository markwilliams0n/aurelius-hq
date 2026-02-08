import { db } from "@/lib/db";
import { configs, configKeyEnum, pendingConfigChanges } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { logConfigChange } from "@/lib/system-events";

export type ConfigKey = (typeof configKeyEnum.enumValues)[number];

export async function getConfig(key: ConfigKey) {
  const [config] = await db
    .select()
    .from(configs)
    .where(eq(configs.key, key))
    .orderBy(desc(configs.version))
    .limit(1);

  return config ?? null;
}

export async function getAllConfigs() {
  const results = await db
    .select()
    .from(configs)
    .orderBy(desc(configs.createdAt));

  // Get latest version of each key
  const latest = new Map<string, typeof results[0]>();
  for (const config of results) {
    if (!latest.has(config.key) || config.version > (latest.get(config.key)?.version ?? 0)) {
      latest.set(config.key, config);
    }
  }

  return Array.from(latest.values());
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

  logConfigChange(key, createdBy);

  return newConfig;
}

// Pending changes management
export async function getPendingChanges() {
  return db
    .select()
    .from(pendingConfigChanges)
    .where(eq(pendingConfigChanges.status, "pending"))
    .orderBy(desc(pendingConfigChanges.createdAt));
}

export async function getPendingChange(id: string) {
  const [change] = await db
    .select()
    .from(pendingConfigChanges)
    .where(eq(pendingConfigChanges.id, id))
    .limit(1);

  return change ?? null;
}

export async function proposePendingChange(
  key: ConfigKey,
  proposedContent: string,
  reason: string,
  conversationId?: string
) {
  const current = await getConfig(key);

  const [pending] = await db
    .insert(pendingConfigChanges)
    .values({
      key,
      currentContent: current?.content ?? null,
      proposedContent,
      reason,
      conversationId: conversationId ?? null,
    })
    .returning();

  return pending;
}

export async function approvePendingChange(id: string) {
  const pending = await getPendingChange(id);
  if (!pending || pending.status !== "pending") {
    return null;
  }

  // Apply the change
  const newConfig = await updateConfig(pending.key, pending.proposedContent, "aurelius");

  // Mark as approved
  await db
    .update(pendingConfigChanges)
    .set({
      status: "approved",
      resolvedAt: new Date(),
    })
    .where(eq(pendingConfigChanges.id, id));

  return newConfig;
}

export async function rejectPendingChange(id: string) {
  const pending = await getPendingChange(id);
  if (!pending || pending.status !== "pending") {
    return false;
  }

  await db
    .update(pendingConfigChanges)
    .set({
      status: "rejected",
      resolvedAt: new Date(),
    })
    .where(eq(pendingConfigChanges.id, id));

  return true;
}

// Config key descriptions for the agent
export const CONFIG_DESCRIPTIONS: Record<ConfigKey, string> = {
  soul: "Personality and behavioral instructions. Defines how I communicate, my tone, and special behaviors.",
  system_prompt: "Core system prompt that defines my fundamental capabilities and context.",
  agents: "Configuration for specialized sub-agents (reserved for future use).",
  processes: "Automated process definitions and schedules (reserved for future use).",
  "capability:tasks": "Instructions for the Tasks capability — how the agent manages tasks via Linear.",
  "capability:config": "Instructions for the Configuration capability — how the agent manages its own config.",
  "prompt:email_draft": "Prompt template for AI-generated email draft replies. Controls tone, style, and formatting of drafts.",
  "capability:slack": "Instructions for the Slack capability — how the agent sends messages via Slack.",
  "slack:directory": "Cached Slack workspace directory (users and channels). Auto-refreshed daily by heartbeat.",
  "capability:vault": "Instructions for the Vault capability — how the agent manages the document library and fact store.",
};
