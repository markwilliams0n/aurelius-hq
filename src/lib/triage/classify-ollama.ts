import { isOllamaAvailable, generate } from "@/lib/memory/ollama";
import { logAiCost } from "./ai-cost";

export type OllamaClassificationResult = {
  batchType: string | null;
  confidence: number;
  reason: string;
};

/**
 * Classify an inbox item using local Ollama LLM.
 * Returns null if Ollama is unavailable or the response can't be parsed.
 */
export async function classifyWithOllama(
  item: {
    id: string;
    connector: string;
    sender: string;
    senderName: string | null;
    subject: string;
    content: string;
  },
  guidanceNotes: string[]
): Promise<OllamaClassificationResult | null> {
  if (!(await isOllamaAvailable())) {
    return null;
  }

  const guidanceBlock =
    guidanceNotes.length > 0
      ? `\nGUIDANCE NOTES (use these to inform your classification):\n${guidanceNotes.map((g) => `- ${g}`).join("\n")}\n`
      : "";

  const prompt = `You are a triage classifier for an inbox system. Classify this item into one of the following batch types, or null if it needs individual attention.

Batch types:
- "archive": Low-value, no action needed (newsletters you never read, automated notifications, marketing)
- "note-archive": Worth a quick note/summary but no action needed (FYI updates, status reports)
- "spam": Junk, phishing, unwanted solicitation
- "attention": Needs your attention but not urgent (can be batched for review)
- null: Needs individual attention — important, urgent, or requires a specific response
${guidanceBlock}
ITEM:
- Source: ${item.connector}
- From: ${item.senderName || item.sender} <${item.sender}>
- Subject: ${item.subject}
- Content: ${item.content.slice(0, 500)}

Respond with ONLY valid JSON, no markdown fences or explanation:
{"batchType": "archive"|"note-archive"|"spam"|"attention"|null, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  try {
    const response = await generate(prompt, { temperature: 0.1 });

    // Fire-and-forget cost logging
    logAiCost({
      provider: "ollama",
      operation: "classify",
      itemId: item.id,
    }).catch((err) =>
      console.error("[Classify Ollama] Failed to log AI cost:", err)
    );

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Classify Ollama] No JSON found in response");
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
    };
  } catch (error) {
    console.error("[Classify Ollama] Classification failed:", error);
    return null;
  }
}
