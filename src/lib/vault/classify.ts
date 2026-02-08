import { generate, isOllamaAvailable } from "@/lib/memory/ollama";
import { getAllTags } from "@/lib/vault";
import { SENSITIVE_PATTERNS } from "@/lib/vault/patterns";

export interface VaultClassification {
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  sensitive: boolean;
}

/** Classify a vault item using Ollama + pattern matching */
export async function classifyVaultItem(
  content: string,
  hints?: { title?: string; type?: string; sensitive?: boolean }
): Promise<VaultClassification> {
  // Pattern-based sensitive detection as baseline
  const patternSensitive = SENSITIVE_PATTERNS.some((p) => p.test(content));

  const existingTags = await getAllTags();

  const available = await isOllamaAvailable();
  if (!available) {
    // Fallback: no AI, use pattern detection + defaults
    return {
      title: hints?.title || content.slice(0, 60).trim(),
      type:
        (hints?.type as VaultClassification["type"]) ||
        (patternSensitive ? "credential" : "fact"),
      tags: [],
      sensitive: hints?.sensitive ?? patternSensitive,
    };
  }

  const prompt = `Classify this item for a personal vault/filing system.

Content (first 500 chars):
${content.slice(0, 500)}

Existing tags in the system: [${existingTags.join(", ")}]
${hints?.title ? `User-provided title: ${hints.title}` : ""}
${hints?.type ? `User-suggested type: ${hints.type}` : ""}

Respond with ONLY a JSON object:
{
  "title": "short descriptive title (3-8 words)",
  "type": "document|fact|credential|reference",
  "tags": ["tag1", "tag2"],
  "sensitive": true/false
}

Rules:
- Prefer existing tags when they fit. Only suggest new tags if nothing fits.
- Max 4 tags.
- "credential" type = contains a specific number/ID (passport, SSN, account number, membership number)
- "fact" type = a piece of information without a specific ID number
- "document" type = longer text content (policy, agreement, certificate)
- "reference" type = a link or pointer to something elsewhere
- "sensitive" = true if it contains SSN, passport numbers, financial account numbers, or other identity-theft-risk data
- Title should be descriptive: "State Farm Auto Insurance Policy", "US Passport Number", "AA Frequent Flyer Number"`;

  const response = await generate(prompt, {
    temperature: 0.1,
    maxTokens: 200,
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(
      jsonMatch[0].replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]")
    );

    return {
      title: hints?.title || parsed.title || content.slice(0, 60).trim(),
      type: (hints?.type as VaultClassification["type"]) || parsed.type || "fact",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : [],
      sensitive: hints?.sensitive ?? parsed.sensitive ?? patternSensitive,
    };
  } catch {
    return {
      title: hints?.title || content.slice(0, 60).trim(),
      type:
        (hints?.type as VaultClassification["type"]) ||
        (patternSensitive ? "credential" : "fact"),
      tags: [],
      sensitive: hints?.sensitive ?? patternSensitive,
    };
  }
}
