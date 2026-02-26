import { chatWithModel } from "@/lib/ai/client";
import { getMemoryContext } from "@/lib/memory/supermemory";
import {
  getDecisionHistory,
  formatDecisionHistory,
} from "./decision-history";
import { getActiveRules } from "./rules";
import type { InboxItem } from "@/lib/db/schema";

// Fast, cheap model for classification (structured JSON, no reasoning needed)
const CLASSIFICATION_MODEL =
  process.env.CLASSIFICATION_MODEL || "google/gemini-2.0-flash-001";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailClassification {
  recommendation: "archive" | "review" | "attention";
  confidence: number; // 0-1
  reasoning: string;
  signals: {
    senderHistory: string;
    relationshipContext: string;
    contentAnalysis: string;
  };
  matchedRules?: string[]; // Rule texts that influenced this classification
}

// ---------------------------------------------------------------------------
// System prompt (constant)
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are an email triage assistant. Classify this email into one of three categories based on the user's history and preferences.

Categories:
- "archive": Email is noise, automated, or something the user consistently ignores.
- "review": Email might be important but the user should glance at it quickly.
- "attention": Email likely needs the user's direct engagement.

Respond with ONLY a JSON object:
{
  "recommendation": "archive" | "review" | "attention",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explanation",
  "signals": {
    "senderHistory": "Brief note about past interactions",
    "relationshipContext": "What we know about sender from memory",
    "contentAnalysis": "What kind of email this is"
  },
  "matchedRules": ["exact text of any triage rule that influenced this decision"]
}

Guidelines:
- If the triage rules explicitly cover this sender/domain, follow the rule with 0.95+ confidence
- If user bulk-archives 100% from this sender, confidence for "archive" should be 0.95+
- New senders with no history → lean toward "attention" with lower confidence
- Direct personal emails from known contacts → almost always "attention"
- Automated notifications → lean toward "archive" unless user has engaged with them
- Weight triage rules heavily — they represent confirmed user preferences
- If you followed a triage rule, include its exact text in matchedRules`;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt for the LLM, including email metadata and
 * all available RAG context (decision history, memory, preferences).
 */
export function buildClassificationPrompt(
  email: {
    sender: string;
    senderName?: string | null;
    subject: string;
    preview?: string | null;
    senderTags?: string[];
  },
  context: {
    decisionHistory: string;
    senderMemoryContext: string;
    rules: string[];
  }
): string {
  const lines: string[] = [];

  // Email metadata
  lines.push("=== EMAIL ===");
  lines.push(`From: ${email.senderName ? `${email.senderName} <${email.sender}>` : email.sender}`);
  lines.push(`Subject: ${email.subject}`);
  if (email.preview) {
    lines.push(`Preview: ${email.preview}`);
  }
  if (email.senderTags && email.senderTags.length > 0) {
    lines.push(`Sender tags: ${email.senderTags.join(", ")}`);
  }

  // Decision history
  lines.push("");
  lines.push("=== DECISION HISTORY ===");
  lines.push(context.decisionHistory || "No prior decisions.");

  // Memory context
  if (context.senderMemoryContext) {
    lines.push("");
    lines.push("=== SENDER CONTEXT (from memory) ===");
    lines.push(context.senderMemoryContext);
  }

  // Triage rules
  if (context.rules.length > 0) {
    lines.push("");
    lines.push("=== TRIAGE RULES ===");
    for (const rule of context.rules) {
      lines.push(`- ${rule}`);
    }
  }

  return lines.join("\n");
}

const VALID_RECOMMENDATIONS = new Set(["archive", "review", "attention"]);

/**
 * Parse and validate the LLM's JSON response. Returns a safe fallback if the
 * response cannot be parsed or contains invalid values.
 */
export function parseClassificationResponse(
  response: string
): EmailClassification {
  const fallback: EmailClassification = {
    recommendation: "attention",
    confidence: 0,
    reasoning: "Could not classify",
    signals: {
      senderHistory: "unknown",
      relationshipContext: "unknown",
      contentAnalysis: "unknown",
    },
  };

  try {
    // Strip markdown fences if present (```json ... ```)
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      // Remove opening fence (optionally with language tag)
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
      // Remove closing fence
      cleaned = cleaned.replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(cleaned);

    // Validate recommendation
    const recommendation = VALID_RECOMMENDATIONS.has(parsed.recommendation)
      ? (parsed.recommendation as "archive" | "review" | "attention")
      : "attention";

    // Clamp confidence to 0-1
    let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    confidence = Math.max(0, Math.min(1, confidence));

    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : fallback.reasoning;

    const signals = {
      senderHistory:
        typeof parsed.signals?.senderHistory === "string"
          ? parsed.signals.senderHistory
          : fallback.signals.senderHistory,
      relationshipContext:
        typeof parsed.signals?.relationshipContext === "string"
          ? parsed.signals.relationshipContext
          : fallback.signals.relationshipContext,
      contentAnalysis:
        typeof parsed.signals?.contentAnalysis === "string"
          ? parsed.signals.contentAnalysis
          : fallback.signals.contentAnalysis,
    };

    const matchedRules = Array.isArray(parsed.matchedRules)
      ? parsed.matchedRules.filter((r: unknown) => typeof r === "string")
      : [];

    return { recommendation, confidence, reasoning, signals, matchedRules };
  } catch {
    return { ...fallback, matchedRules: [] };
  }
}

// ---------------------------------------------------------------------------
// RAG context helpers
// ---------------------------------------------------------------------------

function extractSenderDomain(sender: string): string {
  const atIndex = sender.lastIndexOf("@");
  return atIndex >= 0 ? sender.slice(atIndex + 1) : sender;
}

/**
 * Fetch memory context for a sender from Supermemory.
 * Returns empty string on any failure (missing API key, network, etc.).
 */
async function fetchSenderMemoryContext(
  sender: string,
  senderName?: string | null
): Promise<string> {
  try {
    const query = senderName ? `${senderName} ${sender}` : sender;
    const profile = await getMemoryContext(query);

    const facts: string[] = [
      ...profile.profile.static,
      ...profile.profile.dynamic,
    ];

    return facts.length > 0 ? facts.join("\n") : "";
  } catch {
    return "";
  }
}

/**
 * Fetch active triage rules from the DB and convert each into a human-readable
 * string for inclusion in the LLM classification prompt.
 */
async function fetchActiveRuleTexts(): Promise<string[]> {
  try {
    const rules = await getActiveRules();
    return rules.map((r) => {
      if (r.type === "guidance" && r.guidance) return r.guidance;
      if (r.type === "structured" && r.trigger) {
        const parts: string[] = [];
        const t = r.trigger as Record<string, string>;
        if (t.sender) parts.push(`from ${t.sender}`);
        if (t.senderDomain) parts.push(`from @${t.senderDomain}`);
        if (t.subjectContains) parts.push(`with subject containing "${t.subjectContains}"`);
        return `${r.name}: Archive emails ${parts.join(" ")}`;
      }
      return r.name;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main classification
// ---------------------------------------------------------------------------

/**
 * Classify a single email using LLM + RAG context.
 * Always returns a valid EmailClassification — never throws.
 */
export async function classifyEmail(
  item: InboxItem
): Promise<EmailClassification> {
  try {
    const senderDomain = extractSenderDomain(item.sender);

    // Gather RAG context in parallel
    const [decisionSummary, senderMemoryContext, rules] =
      await Promise.all([
        getDecisionHistory(item.sender, senderDomain),
        fetchSenderMemoryContext(item.sender, item.senderName),
        fetchActiveRuleTexts(),
      ]);

    const decisionHistory = formatDecisionHistory(decisionSummary);

    const senderTags =
      (item.enrichment as { senderTags?: string[] } | null)?.senderTags ?? [];

    const prompt = buildClassificationPrompt(
      {
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        preview: item.preview,
        senderTags,
      },
      {
        decisionHistory,
        senderMemoryContext,
        rules,
      }
    );

    const response = await chatWithModel(
      CLASSIFICATION_MODEL,
      prompt,
      CLASSIFICATION_SYSTEM_PROMPT,
      { maxTokens: 512, timeoutMs: 15_000 }
    );

    return parseClassificationResponse(response);
  } catch (error) {
    console.error("[classify-email] Classification failed:", error);
    return {
      recommendation: "attention",
      confidence: 0,
      reasoning: "Classification failed — defaulting to attention",
      signals: {
        senderHistory: "unknown",
        relationshipContext: "unknown",
        contentAnalysis: "unknown",
      },
    };
  }
}

/**
 * Classify a batch of emails in parallel groups of 5.
 * Returns a Map keyed by inbox item ID.
 */
export async function classifyEmails(
  items: InboxItem[]
): Promise<Map<string, EmailClassification>> {
  const results = new Map<string, EmailClassification>();

  const BATCH_SIZE = 5;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map((item) => classifyEmail(item))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = settled[j];
      const item = batch[j];

      if (result.status === "fulfilled") {
        results.set(item.id, result.value);
      } else {
        console.error(
          `[classify-email] Batch item ${item.id} failed:`,
          result.reason
        );
        results.set(item.id, {
          recommendation: "attention",
          confidence: 0,
          reasoning: "Classification failed — defaulting to attention",
          signals: {
            senderHistory: "unknown",
            relationshipContext: "unknown",
            contentAnalysis: "unknown",
          },
        });
      }
    }
  }

  return results;
}
