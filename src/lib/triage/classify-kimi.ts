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

  const systemPrompt = `You are a triage classifier for an inbox system. Classify items and provide enrichment data.

Batch types:
- "archive": Low-value, no action needed (newsletters you never read, automated notifications, marketing)
- "note-archive": Worth a quick note/summary but no action needed (FYI updates, status reports)
- "spam": Junk, phishing, unwanted solicitation
- "attention": Needs your attention but not urgent (can be batched for review)
- null: Needs individual attention — important, urgent, or requires a specific response
${guidanceBlock}
Respond with ONLY valid JSON, no markdown fences or explanation:
{
  "batchType": "archive"|"note-archive"|"spam"|"attention"|null,
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
