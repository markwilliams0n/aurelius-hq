import { generate, isOllamaAvailable } from "@/lib/memory/ollama";
import { ai, DEFAULT_MODEL } from "@/lib/ai/client";
import { getAllTags } from "@/lib/vault";
import { SENSITIVE_PATTERNS, redactSensitiveContent } from "@/lib/vault/patterns";

/** Generate text via OpenRouter (for non-Ollama models like kimi) */
async function generateViaOpenRouter(prompt: string): Promise<string> {
  const result = ai.callModel({
    model: DEFAULT_MODEL,
    input: prompt,
    instructions: "Respond with ONLY the requested JSON. No explanation.",
  });
  return result.getText();
}

export interface VaultClassification {
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  sensitive: boolean;
  normalizedContent?: string;
  searchKeywords?: string[];
}

/** Classify a vault item using Ollama + pattern matching */
export async function classifyVaultItem(
  content: string,
  hints?: { title?: string; type?: string; sensitive?: boolean },
  options?: { model?: string }
): Promise<VaultClassification> {
  // Pattern-based sensitive detection as baseline
  const patternSensitive = SENSITIVE_PATTERNS.some((p) => p.test(content));

  const existingTags = await getAllTags();

  const useOpenRouter = options?.model === "kimi";

  if (!useOpenRouter) {
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
  }

  // Redact sensitive content before sending to LLM
  const contentForClassification = patternSensitive
    ? redactSensitiveContent(content.slice(0, 500))
    : content.slice(0, 500);

  const prompt = `Classify this item for a personal vault/filing system.

Content (first 500 chars):
${contentForClassification}

Existing tags in the system: [${existingTags.join(", ")}]
${hints?.title ? `User-provided title: ${hints.title}` : ""}
${hints?.type ? `User-suggested type: ${hints.type}` : ""}

Respond with ONLY a JSON object:
{
  "title": "short descriptive title (3-8 words)",
  "type": "document|fact|credential|reference",
  "tags": ["tag1", "tag2"],
  "sensitive": true/false,
  "normalizedContent": "cleaned up version of the content (normalize dates to YYYY-MM-DD, expand abbreviations, fix formatting)",
  "searchKeywords": ["keyword1", "keyword2"]
}

Rules:
- Prefer existing tags when they fit. Only suggest new tags if nothing fits.
- Max 4 tags.
- "credential" type = contains a specific number/ID (passport, SSN, account number, membership number)
- "fact" type = a piece of information without a specific ID number
- "document" type = longer text content (policy, agreement, certificate)
- "reference" type = a link or pointer to something elsewhere
- "sensitive" = true if it contains SSN, passport numbers, financial account numbers, or other identity-theft-risk data
- Title should be descriptive: "State Farm Auto Insurance Policy", "US Passport Number", "AA Frequent Flyer Number"
- normalizedContent: clean up the raw content. Normalize dates (e.g. "3.3.83" → "1983-03-03", "March 3, 1983"), expand shorthand, fix formatting. Keep the original value but make it more useful.
- searchKeywords: 2-6 alternative words/phrases someone might search to find this item (synonyms, related terms, alternate date formats). E.g. for a birthday: ["date of birth", "DOB", "born", "March 1983"]`;

  const response = useOpenRouter
    ? await generateViaOpenRouter(prompt)
    : await generate(prompt, { temperature: 0.1, maxTokens: 200 });

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
      normalizedContent: parsed.normalizedContent || undefined,
      searchKeywords: Array.isArray(parsed.searchKeywords) ? parsed.searchKeywords.slice(0, 6) : undefined,
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
