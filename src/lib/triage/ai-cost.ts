import { db } from "@/lib/db";
import { aiCostLog } from "@/lib/db/schema";
import { desc, sql, gte } from "drizzle-orm";

// Cost rates per 1K tokens by provider
const COST_RATES: Record<string, { input: number; output: number }> = {
  ollama: { input: 0, output: 0 },
  kimi: { input: 0.0006, output: 0.0024 },
};

type LogAiCostEntry = {
  provider: string;
  operation: string;
  itemId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  result?: Record<string, unknown> | null;
};

/**
 * Log an AI cost entry. Automatically estimates cost from token counts.
 */
export async function logAiCost(entry: LogAiCostEntry) {
  const rates = COST_RATES[entry.provider] ?? { input: 0, output: 0 };
  const inputCost = ((entry.inputTokens ?? 0) / 1000) * rates.input;
  const outputCost = ((entry.outputTokens ?? 0) / 1000) * rates.output;
  const estimatedCost = (inputCost + outputCost).toFixed(6);

  await db.insert(aiCostLog).values({
    provider: entry.provider,
    operation: entry.operation,
    itemId: entry.itemId ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    estimatedCost,
    result: entry.result ?? null,
  });
}

/**
 * Get aggregated cost summary grouped by provider + operation for the last N days.
 */
export async function getCostSummary(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({
      provider: aiCostLog.provider,
      operation: aiCostLog.operation,
      totalInputTokens: sql<number>`coalesce(sum(${aiCostLog.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${aiCostLog.outputTokens}), 0)::int`,
      totalCost: sql<string>`coalesce(sum(${aiCostLog.estimatedCost}::numeric), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(aiCostLog)
    .where(gte(aiCostLog.createdAt, since))
    .groupBy(aiCostLog.provider, aiCostLog.operation);

  return rows;
}

/**
 * Get recent cost log entries.
 */
export async function getRecentCosts(limit = 50) {
  const rows = await db
    .select()
    .from(aiCostLog)
    .orderBy(desc(aiCostLog.createdAt))
    .limit(limit);

  return rows;
}
