/**
 * Email Classification Pipeline
 *
 * Replaces the old 3-tier (rules -> Ollama -> Kimi) pipeline
 * with an AI-first classifier using decision history and Supermemory context.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { classifyEmails, type EmailClassification } from './classify-email';
import { getActiveRules, incrementRuleMatchCount } from './rules';

export interface ClassifyEmailsResult {
  classified: number;
  byTier: { archive: number; review: number; attention: number };
}

export async function classifyNewEmails(): Promise<ClassifyEmailsResult> {
  // Fetch unclassified gmail items
  const items = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, 'new'),
        eq(inboxItems.connector, 'gmail'),
        isNull(inboxItems.classification)
      )
    );

  if (items.length === 0) {
    return { classified: 0, byTier: { archive: 0, review: 0, attention: 0 } };
  }

  console.log(`[Classify] ${items.length} unclassified emails to process`);

  const classifications = await classifyEmails(items);
  const byTier = { archive: 0, review: 0, attention: 0 };

  // Save classifications to DB
  for (const item of items) {
    const classification = classifications.get(item.id);
    if (!classification) continue;

    byTier[classification.recommendation]++;

    const existingEnrichment = (item.enrichment as Record<string, unknown>) || {};

    await db
      .update(inboxItems)
      .set({
        classification: {
          recommendation: classification.recommendation,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          signals: classification.signals,
          classifiedAt: new Date().toISOString(),
        },
        enrichment: {
          ...existingEnrichment,
          aiClassification: classification,
        } as typeof inboxItems.$inferInsert.enrichment,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, item.id));
  }

  // Update hit counts for rules that the classifier referenced
  try {
    const activeRules = await getActiveRules();
    for (const item of items) {
      const classification = classifications.get(item.id);
      if (!classification?.matchedRules?.length) continue;

      for (const ruleText of classification.matchedRules) {
        const matchedRule = activeRules.find(
          (r) => r.guidance === ruleText || r.name === ruleText
        );
        if (matchedRule) {
          await incrementRuleMatchCount(matchedRule.id);
        }
      }
    }
  } catch (err) {
    console.error("[Classify] Rule hit tracking failed:", err);
  }

  console.log(
    `[Classify] Done: ${items.length} emails ` +
    `(archive:${byTier.archive} review:${byTier.review} attention:${byTier.attention})`
  );

  return { classified: items.length, byTier };
}
