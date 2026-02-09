import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import type { InboxItem, TriageRule } from "@/lib/db/schema";
import { eq, isNull, and, sql } from "drizzle-orm";
import { matchRule, getActiveRules, incrementRuleMatchCount } from "./rules";
import { getGuidanceNotes } from "./rules";
import { assignItemsToBatchCards } from "./batch-cards";
import { classifyWithOllama } from "./classify-ollama";
import { classifyWithKimi } from "./classify-kimi";

/** Confidence threshold for accepting Ollama classification */
const OLLAMA_CONFIDENCE_THRESHOLD = 0.85;

/** Result of classifying a single item */
export type ClassificationResult = {
  batchType: string | null;
  tier: "rule" | "ollama" | "kimi";
  confidence: number;
  reason: string;
  ruleId?: string;
  enrichment?: {
    summary?: string;
    suggestedPriority?: string;
    suggestedTags?: string[];
  };
};

/**
 * Classify a single inbox item through a 3-pass pipeline:
 *
 * Pass 1 — Rule matching: deterministic structured rules
 * Pass 2 — Ollama: fast local LLM (if available and confident)
 * Pass 3 — Kimi: cloud LLM with enrichment (fallback)
 */
/** Connectors whose items should always surface individually (never batch-grouped) */
const INDIVIDUAL_CONNECTORS = new Set(["granola"]);

export async function classifyItem(
  item: InboxItem,
  rules?: TriageRule[]
): Promise<ClassificationResult> {
  // Items from certain connectors always stay individual
  if (INDIVIDUAL_CONNECTORS.has(item.connector)) {
    return {
      batchType: null,
      tier: "rule",
      confidence: 1,
      reason: `${item.connector} items are always kept for individual review`,
    };
  }

  // Pass 1: Structured rule matching
  const activeRules = rules ?? (await getActiveRules());

  for (const rule of activeRules) {
    if (matchRule(rule, item)) {
      const batchType = rule.action?.batchType ?? null;

      // Fire-and-forget: increment match count
      if (rule.id) {
        incrementRuleMatchCount(rule.id).catch((err) =>
          console.error("[Classify] Failed to increment rule match count:", err)
        );
      }

      return {
        batchType,
        tier: "rule",
        confidence: 1.0,
        reason: `Matched rule: ${rule.name}`,
        ruleId: rule.id,
      };
    }
  }

  // Gather guidance notes for AI classifiers
  const guidanceNotes = activeRules
    .filter((r) => r.type === "guidance" && r.guidance)
    .map((r) => r.guidance!);

  // Pass 2: Ollama (local, fast, free)
  const ollamaResult = await classifyWithOllama(
    {
      id: item.id,
      connector: item.connector,
      sender: item.sender,
      senderName: item.senderName,
      subject: item.subject,
      content: item.content,
    },
    guidanceNotes
  );

  if (ollamaResult && ollamaResult.confidence >= OLLAMA_CONFIDENCE_THRESHOLD) {
    return {
      batchType: ollamaResult.batchType,
      tier: "ollama",
      confidence: ollamaResult.confidence,
      reason: ollamaResult.reason,
    };
  }

  // Pass 3: Kimi (cloud, enrichment)
  const kimiResult = await classifyWithKimi(
    {
      id: item.id,
      connector: item.connector,
      sender: item.sender,
      senderName: item.senderName,
      subject: item.subject,
      content: item.content,
    },
    guidanceNotes
  );

  if (kimiResult) {
    return {
      batchType: kimiResult.batchType,
      tier: "kimi",
      confidence: kimiResult.confidence,
      reason: kimiResult.reason,
      enrichment: kimiResult.enrichment,
    };
  }

  // Fallback: classification failed entirely
  return {
    batchType: null,
    tier: "kimi",
    confidence: 0,
    reason: "Classification failed",
  };
}

/**
 * Batch classify all unclassified inbox items (status = 'new', classification IS NULL).
 * Returns summary stats of what was classified and by which tier.
 */
export async function classifyNewItems(): Promise<{
  classified: number;
  byTier: { rule: number; ollama: number; kimi: number };
}> {
  // Fetch unclassified items
  const items = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.status, "new"), isNull(inboxItems.classification)));

  const byTier = { rule: 0, ollama: 0, kimi: 0 };

  if (items.length > 0) {
    // Fetch rules once for all items
    const rules = await getActiveRules();

    for (const item of items) {
      try {
        const result = await classifyItem(item, rules);
        byTier[result.tier]++;

        // Build classification data for the DB column
        const classification = {
          batchCardId: null,
          batchType: result.batchType,
          tier: result.tier,
          confidence: result.confidence,
          reason: result.reason,
          classifiedAt: new Date().toISOString(),
          ...(result.ruleId ? { ruleId: result.ruleId } : {}),
        };

        // Build the update — classification + optional enrichment merge
        const updateData: Record<string, unknown> = {
          classification,
          updatedAt: new Date(),
        };

        // If Kimi returned enrichment, merge it into existing enrichment
        if (result.enrichment) {
          const existingEnrichment =
            (item.enrichment as Record<string, unknown>) || {};
          updateData.enrichment = {
            ...existingEnrichment,
            ...result.enrichment,
          };
        }

        await db
          .update(inboxItems)
          .set(updateData)
          .where(eq(inboxItems.id, item.id));
      } catch (error) {
        console.error(
          `[Classify] Failed to classify item ${item.id}:`,
          error
        );
        // Continue with remaining items
      }
    }
  }

  // Re-run rule matching on items that were previously classified with null batchType.
  // This catches items that now match newly created rules (e.g. seed rules, user rules).
  const reclassified = await reclassifyNullBatchItems();
  if (reclassified > 0) {
    console.log(`[Classify] Reclassified ${reclassified} items via rules`);
  }

  // Always assign classified items to batch cards — handles both newly
  // classified items and any orphaned items from previous runs
  const batchResult = await assignItemsToBatchCards();
  if (batchResult.assigned > 0) {
    console.log(`[Classify] Assigned ${batchResult.assigned} items to batch cards:`, batchResult.cards);
  }

  return { classified: items.length, byTier };
}

/**
 * Re-run rule matching (pass 1 only) on items that have classification
 * but batchType is null. This picks up items that now match newly created rules
 * without making any AI calls.
 */
async function reclassifyNullBatchItems(): Promise<number> {
  const items = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, "new"),
        sql`${inboxItems.classification} IS NOT NULL`,
        sql`${inboxItems.classification}->>'batchType' IS NULL`,
        // Don't re-classify items the user explicitly removed from groups
        sql`COALESCE(${inboxItems.classification}->>'reason', '') NOT LIKE 'User removed from%'`
      )
    );

  if (items.length === 0) return 0;

  const rules = await getActiveRules();
  let reclassified = 0;

  for (const item of items) {
    for (const rule of rules) {
      if (matchRule(rule, item)) {
        const batchType = rule.action?.batchType ?? null;
        if (!batchType) continue;

        // Update classification with the matched rule
        const existing = (item.classification as Record<string, unknown>) || {};
        await db
          .update(inboxItems)
          .set({
            classification: {
              ...existing,
              batchType,
              batchCardId: null, // will be assigned by assignItemsToBatchCards
              tier: "rule" as const,
              confidence: 1,
              reason: `Matched rule: ${rule.name}`,
              classifiedAt: new Date().toISOString(),
              ruleId: rule.id,
            },
            updatedAt: new Date(),
          })
          .where(eq(inboxItems.id, item.id));

        if (rule.id) {
          incrementRuleMatchCount(rule.id).catch(() => {});
        }

        reclassified++;
        break; // first matching rule wins
      }
    }
  }

  return reclassified;
}
