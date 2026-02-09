import { chat } from "@/lib/ai/client";
import { logAiCost } from "./ai-cost";

export type KimiClassificationResult = {
  batchType: string | null;
  confidence: number;
  reason: string;
  enrichment: {
    summary?: string;
    suggestedPriority?: string;
    suggestedTags?: string[];
  };
};

/**
 * Classify an inbox item using Kimi (via OpenRouter).
 * Also returns enrichment data (summary, priority, tags).
 * Returns null on failure.
 */
export async function classifyWithKimi(
  item: {
    id: string;
    connector: string;
    sender: string;
    senderName: string | null;
    subject: string;
    content: string;
  },
  guidanceNotes: string[]
): Promise<KimiClassificationResult | null> {
  const guidanceBlock =
    guidanceNotes.length > 0
      ? `\nGUIDANCE NOTES (use these to inform your classification):\n${guidanceNotes.map((g) => `- ${g}`).join("\n")}\n`
      : "";

  const systemPrompt = `You are a conservative triage classifier. Classify items into groups or return null for individual attention. When in doubt, return null.

Groups:
- "notifications": ONLY for clearly automated tool/system messages: CI/CD failures, bot alerts, deployment notifications, device sign-ins, OAuth alerts, Figma thread notifications, Slack confirmation codes. NOT for messages from real people.
- "finance": Automated financial notifications: invoice alerts, purchase order confirmations, payment processed notifications, credit card charges, billing reminders, payroll alerts. Must be system-generated (from noreply/automated addresses), not personal financial discussions.
- "newsletters": Marketing emails, industry digests, subscription content, press releases, analytics reports (beehiiv, Substack, etc.). NOT for personal emails even if they contain news.
- "calendar": Meeting invites, calendar acceptances/declines, RSVPs, scheduling changes. System-generated calendar notifications.
- "spam": Cold outreach from unknown senders, junk mail, unsolicited sales pitches, phishing attempts.
- null: DEFAULT. Use for anything from a real person writing a real message, anything you're unsure about, anything that needs a personal response. If in doubt, return null.

CRITICAL: Real people writing real messages = null. Always.
${guidanceBlock}
Respond with ONLY valid JSON, no markdown fences:
{
  "batchType": "notifications"|"finance"|"newsletters"|"calendar"|"spam"|null,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "enrichment": {
    "summary": "1-2 sentence summary of the item",
    "suggestedPriority": "urgent|high|normal|low",
    "suggestedTags": ["tag1", "tag2"]
  }
}`;

  const input = `Classify this inbox item:

- Source: ${item.connector}
- From: ${item.senderName || item.sender} <${item.sender}>
- Subject: ${item.subject}
- Content: ${item.content.slice(0, 1500)}`;

  try {
    const response = await chat(input, systemPrompt);

    // Fire-and-forget cost logging
    logAiCost({
      provider: "kimi",
      operation: "classify",
      itemId: item.id,
    }).catch((err) =>
      console.error("[Classify Kimi] Failed to log AI cost:", err)
    );

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Classify Kimi] No JSON found in response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      batchType: parsed.batchType ?? null,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      reason: String(parsed.reason || "No reason provided"),
      enrichment: {
        summary: parsed.enrichment?.summary,
        suggestedPriority: parsed.enrichment?.suggestedPriority,
        suggestedTags: Array.isArray(parsed.enrichment?.suggestedTags)
          ? parsed.enrichment.suggestedTags
          : undefined,
      },
    };
  } catch (error) {
    console.error("[Classify Kimi] Classification failed:", error);
    return null;
  }
}
