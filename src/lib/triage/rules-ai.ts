import { chat } from "@/lib/ai/client";
import type { NewTriageRule } from "@/lib/db/schema";

/**
 * Result of parsing natural language into a rule.
 * Either a structured rule (deterministic matching) or a guidance note (AI context).
 */
export type ParsedRule = {
  type: "structured" | "guidance";
  name: string;
  description: string;
  source: "user_chat";
  // Structured rule fields
  trigger?: NewTriageRule["trigger"];
  action?: NewTriageRule["action"];
  // Guidance note fields
  guidance?: string;
};

const PARSE_PROMPT = `You are a triage rule parser for an inbox system. The user will give you a natural language instruction about how to handle certain inbox items.

Your job: determine whether this instruction can be expressed as a simple deterministic rule (structured) or if it requires nuanced AI judgment (guidance).

## Structured rules
Use when the instruction is a simple pattern match:
- Specific senders or sender domains
- Specific connectors (gmail, slack, linear, granola)
- Keyword matches in subject or content
- Regex patterns

Return JSON:
{
  "type": "structured",
  "name": "Short rule name",
  "description": "What this rule does",
  "trigger": {
    "connector": "gmail|slack|linear|granola" (optional),
    "sender": "exact@email.com" (optional),
    "senderDomain": "example.com" (optional),
    "subjectContains": "keyword" (optional),
    "contentContains": "keyword" (optional),
    "pattern": "regex pattern" (optional)
  },
  "action": {
    "type": "batch",
    "batchType": "archive|review|urgent|newsletter|noise",
    "label": "Human-readable label" (optional)
  }
}

## Guidance notes
Use when the instruction involves context, judgment, or nuance that can't be expressed as a simple pattern. Examples: "be gentle when replying to clients", "prioritize messages from my team", "anything about Project X is high priority right now".

Return JSON:
{
  "type": "guidance",
  "name": "Short rule name",
  "description": "What this guidance does",
  "guidance": "The full instruction in a clear form for AI context"
}

Respond with ONLY valid JSON, no markdown fences or explanation.`;

/**
 * Parse a natural language instruction into a triage rule definition.
 * Uses Kimi to determine whether the instruction maps to a structured rule
 * or a guidance note.
 */
export async function parseNaturalLanguageRule(input: string): Promise<ParsedRule> {
  const response = await chat(
    `Parse this triage instruction into a rule:\n\n"${input}"`,
    PARSE_PROMPT
  );

  // TODO: log AI cost

  // Extract JSON from response (handle potential markdown fences)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON for rule parsing");
  }

  const parsed = JSON.parse(jsonMatch[0]) as ParsedRule;

  // Ensure source is always set
  parsed.source = "user_chat";

  // Validate required fields
  if (!parsed.type || !parsed.name) {
    throw new Error("Parsed rule missing required fields (type, name)");
  }

  if (parsed.type === "structured" && !parsed.trigger) {
    throw new Error("Structured rule missing trigger definition");
  }

  if (parsed.type === "guidance" && !parsed.guidance) {
    throw new Error("Guidance rule missing guidance text");
  }

  return parsed;
}
