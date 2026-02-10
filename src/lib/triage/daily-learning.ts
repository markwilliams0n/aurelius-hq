import { db } from "@/lib/db";
import { activityLog, actionCards } from "@/lib/db/schema";
import { eq, gte, desc, and } from "drizzle-orm";
import { chat } from "@/lib/ai/client";
import { getAllRules } from "./rules";
import { logAiCost } from "./ai-cost";
import { generateCardId } from "@/lib/action-cards/db";

/** A single learning suggestion from the AI */
export type LearningSuggestion = {
  type: "new_rule" | "refine_rule";
  ruleType: "structured" | "guidance";
  name: string;
  description: string;
  trigger?: Record<string, string>;
  action?: Record<string, string>;
  guidance?: string;
  confidence: number;
  reasoning: string;
};

/** Result of running the daily learning loop */
export type DailyLearningResult = {
  suggestions: number;
  cardId: string | null;
};

/**
 * Analyze the last 24 hours of triage actions and suggest rules.
 *
 * Steps:
 * 1. Query recent triage_action entries from the activity log
 * 2. Fetch all current rules for context
 * 3. Ask Kimi to analyze patterns and suggest new rules or refinements
 * 4. Create a batch card with the suggestions for review
 */
export async function runDailyLearning(): Promise<DailyLearningResult> {
  // 1. Query last 24h of triage actions
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentActions = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.eventType, "triage_action"),
        gte(activityLog.createdAt, since),
      )
    )
    .orderBy(desc(activityLog.createdAt));

  // 2. If no actions, return early
  if (recentActions.length === 0) {
    console.log("[DailyLearning] No triage actions in the last 24h, skipping");
    return { suggestions: 0, cardId: null };
  }

  // 3. Get all current rules for context
  const currentRules = await getAllRules();

  // 4. Build prompt
  const rulesContext = currentRules.length > 0
    ? currentRules
        .map(
          (r) =>
            `- [${r.type}] "${r.name}": ${r.description ?? "(no description)"}${
              r.trigger ? ` | trigger: ${JSON.stringify(r.trigger)}` : ""
            }${r.guidance ? ` | guidance: ${r.guidance}` : ""}`
        )
        .join("\n")
    : "(no rules yet)";

  const actionsContext = recentActions
    .map(
      (a) =>
        `- [${a.createdAt.toISOString()}] ${a.description}`
    )
    .join("\n");

  const systemPrompt = `You are Aurelius, an AI assistant that learns from triage patterns.

Analyze the triage actions taken in the last 24 hours and compare them against existing rules. Suggest new rules or refinements that would automate or improve future triage.

EXISTING RULES:
${rulesContext}

RECENT TRIAGE ACTIONS (last 24h):
${actionsContext}

Respond with ONLY a JSON array of suggestions. No markdown fences, no explanation outside the JSON.

Each suggestion should have:
- "type": "new_rule" or "refine_rule"
- "ruleType": "structured" (deterministic trigger/action) or "guidance" (context for AI)
- "name": short rule name
- "description": what the rule does
- "trigger": object with optional fields: connector, sender, senderDomain, subjectContains, contentContains, pattern (only for structured rules)
- "action": object with type and batchType (only for structured rules)
- "guidance": guidance text (only for guidance rules)
- "confidence": 0.0-1.0 how confident you are this pattern is real
- "reasoning": why you suggest this rule

Only suggest rules with confidence >= 0.6. If no patterns are worth suggesting, return an empty array [].`;

  // 5. Call Kimi
  const response = await chat(
    `Analyze these ${recentActions.length} triage actions and suggest rule improvements.`,
    systemPrompt,
    { maxTokens: 1024 }
  );

  // 6. Log AI cost
  await logAiCost({
    provider: "kimi",
    operation: "daily_learning",
  });

  // 7. Parse JSON response
  let suggestions: LearningSuggestion[] = [];
  try {
    // Strip markdown fences if present (despite instructions)
    const cleaned = response
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      suggestions = parsed;
    } else {
      console.warn("[DailyLearning] AI response was not an array, got:", typeof parsed);
    }
  } catch (err) {
    console.warn("[DailyLearning] Failed to parse AI response:", err);
    console.warn("[DailyLearning] Raw response:", response.slice(0, 500));
    return { suggestions: 0, cardId: null };
  }

  // 8. If suggestions exist, create a batch card
  if (suggestions.length === 0) {
    console.log("[DailyLearning] No suggestions from AI analysis");
    return { suggestions: 0, cardId: null };
  }

  const cardId = generateCardId();
  const title =
    suggestions.length === 1
      ? "Aurelius learned 1 new pattern yesterday"
      : `Aurelius learned ${suggestions.length} new patterns yesterday`;

  await db.insert(actionCards).values({
    id: cardId,
    pattern: "batch",
    status: "pending",
    title,
    handler: "batch:learning",
    data: {
      batchType: "learning",
      suggestions,
      explanation: `Based on ${recentActions.length} triage actions in the last 24 hours, ${suggestions.length} pattern(s) were identified that could improve future triage.`,
    },
  });

  console.log(
    `[DailyLearning] Created card ${cardId} with ${suggestions.length} suggestions`
  );

  // 9. Return result
  return { suggestions: suggestions.length, cardId };
}
