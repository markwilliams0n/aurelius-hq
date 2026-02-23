import { chat } from "@/lib/ai/client";

interface SummarizeResult {
  summary: string;
  tags: string[];
}

const VALID_TAGS = [
  "tech", "business", "design", "AI", "finance",
  "culture", "health", "science", "other",
];

const SUMMARIZE_TIMEOUT_MS = 15000;

export async function summarizeBookmark(content: string, author: string): Promise<SummarizeResult> {
  const prompt = `Summarize this tweet/thread by @${author} in 1-2 sentences. Then assign 1-3 topic tags from this list: ${VALID_TAGS.join(", ")}.

Tweet content:
${content}

Respond in this exact JSON format, no other text:
{"summary": "...", "tags": ["...", "..."]}`;

  let result: string;
  try {
    result = await Promise.race([
      chat(prompt, "You are a concise summarizer. Respond only with valid JSON.", { maxTokens: 256 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Summarization timed out")), SUMMARIZE_TIMEOUT_MS)
      ),
    ]);
  } catch (e) {
    console.error(`[Summarize] Failed for @${author}:`, e);
    return {
      summary: content.slice(0, 200),
      tags: ["other"],
    };
  }

  try {
    // Strip markdown code fences if present
    let cleaned = result.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || content.slice(0, 200),
      tags: (parsed.tags || []).filter((t: string) => VALID_TAGS.includes(t)),
    };
  } catch (e) {
    console.error("[Summarize] Failed to parse model response:", result.slice(0, 300), e);
    return {
      summary: content.slice(0, 200),
      tags: ["other"],
    };
  }
}
