import { isOllamaAvailable, generate } from "@/lib/memory/ollama";
import { logAiCost } from "./ai-cost";

export type OllamaClassificationResult = {
  batchType: string | null;
  confidence: number;
  reason: string;
};

/** Sender patterns that indicate automated/system messages */
const AUTO_SENDER_PATTERNS = [
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "notifications@", "notification@", "notify@",
  "mailer@", "mailer-daemon", "postmaster@",
  "alerts@", "alert@", "monitoring@",
  "support@", "helpdesk@", "help@",
  "team@", "info@", "hello@",
  "updates@", "digest@", "newsletter@",
  "github.com", "linear.app", "figma.com", "slack.com",
  "intercom", "airtable.com", "resend.com",
  "beehiiv", "substack.com", "mailchimp",
];

/**
 * Check if the sender looks like an automated system rather than a real person.
 * This pre-filter prevents Ollama from misclassifying real people's emails.
 */
function looksAutomated(sender: string, senderName: string | null, subject: string): boolean {
  const senderLower = sender.toLowerCase();

  // Check sender email against known automated patterns
  if (AUTO_SENDER_PATTERNS.some(p => senderLower.includes(p))) {
    return true;
  }

  // GitHub CI notifications
  if (senderLower.includes("github") && subject.includes("run failed")) {
    return true;
  }

  // Connector-specific: Linear and Granola items are already structured
  // They don't come through email sender patterns

  return false;
}

/**
 * Classify an inbox item using local Ollama LLM.
 * Returns null if Ollama is unavailable, the sender looks like a real person,
 * or the response can't be parsed.
 *
 * Ollama is only used for items that look automated. Real people's emails
 * skip Ollama entirely and go to Kimi (or surface individually).
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

  // Pre-filter: only classify items that look automated.
  // Real people's emails are too nuanced for a small local model.
  if (!looksAutomated(item.sender, item.senderName, item.subject)) {
    return null;
  }

  const guidanceBlock =
    guidanceNotes.length > 0
      ? `\nGUIDANCE NOTES (use these to inform your classification):\n${guidanceNotes.map((g) => `- ${g}`).join("\n")}\n`
      : "";

  const prompt = `This is an automated/system message. Classify it into the most appropriate group.

Groups:
- "notifications": CI/CD failures, tool alerts, system status, device sign-ins, OAuth notifications, deployment updates
- "finance": Invoices, purchase orders, payment confirmations, billing alerts, credit card charges, payroll reminders, insurance
- "newsletters": Marketing emails, industry digests, subscription content, press releases, analytics reports
- "calendar": Meeting invites, calendar acceptances, RSVPs, scheduling changes
- "spam": Cold outreach, junk, unsolicited sales pitches
- null: If unsure or doesn't fit any group

${guidanceBlock}
ITEM:
- Source: ${item.connector}
- From: ${item.senderName || item.sender} <${item.sender}>
- Subject: ${item.subject}
- Content: ${item.content.slice(0, 500)}

Respond with ONLY valid JSON, no markdown fences:
{"batchType": "notifications"|"finance"|"newsletters"|"calendar"|"spam"|null, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

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

    // Strip markdown code fences if present, then extract JSON
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Classify Ollama] No JSON found in response:", cleaned.slice(0, 200));
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
