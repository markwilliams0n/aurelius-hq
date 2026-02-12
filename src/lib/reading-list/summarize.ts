import { chat } from "@/lib/ai/client";

interface SummarizeResult {
  summary: string;
  tags: string[];
}

const VALID_TAGS = [
  "tech", "business", "design", "AI", "finance",
  "culture", "health", "science", "other",
];

export async function summarizeBookmark(content: string, author: string): Promise<SummarizeResult> {
  const prompt = `Summarize this tweet/thread by @${author} in 1-2 sentences. Then assign 1-3 topic tags from this list: ${VALID_TAGS.join(", ")}.

Tweet content:
${content}

Respond in this exact JSON format, no other text:
{"summary": "...", "tags": ["...", "..."]}`;

  const result = await chat(prompt, "You are a concise summarizer. Respond only with valid JSON.", { maxTokens: 256 });

  try {
    const parsed = JSON.parse(result.trim());
    return {
      summary: parsed.summary || content.slice(0, 200),
      tags: (parsed.tags || []).filter((t: string) => VALID_TAGS.includes(t)),
    };
  } catch {
    return {
      summary: content.slice(0, 200),
      tags: ["other"],
    };
  }
}
