import { generate, isOllamaAvailable } from "@/lib/memory/ollama";
import { addMemory } from "@/lib/memory/supermemory";
import { getVaultItem, updateVaultItem } from "@/lib/vault";
import { redactSensitiveContent } from "@/lib/vault/patterns";

export type SummaryLevel = "short" | "medium" | "detailed" | "full";

/** Generate a summary of a vault item at a given level using Ollama */
export async function generateSummary(
  itemId: string,
  level: SummaryLevel
): Promise<string> {
  const item = await getVaultItem(itemId);
  if (!item) throw new Error("Vault item not found");

  // Full level: return content as-is (minus sensitive values)
  if (level === "full") {
    if (item.sensitive) {
      return `[Vault item: ${item.title}] ${item.content ? redactSensitiveContent(item.content) : item.title}`;
    }
    return item.content || item.title;
  }

  const available = await isOllamaAvailable();
  if (!available) {
    // Fallback: return title + type as short summary
    return `${item.title} (${item.type})`;
  }

  const sensitiveNote = item.sensitive
    ? "\nIMPORTANT: This item is marked SENSITIVE. Do NOT include the actual sensitive value (numbers, IDs, account numbers) in the summary. Describe what it is without the value."
    : "";

  const levelInstructions: Record<SummaryLevel, string> = {
    short:
      "Write a ONE-LINE summary (max 20 words). Just the essential fact.",
    medium:
      "Write a PARAGRAPH summary with key details (dates, amounts, parties involved). 2-4 sentences.",
    detailed:
      "Write a DETAILED summary covering all important information. Multiple paragraphs if needed.",
    full: "", // handled above
  };

  // Redact sensitive content before sending to Ollama
  let contentForSummary = item.content?.slice(0, 2000) || "[no text content]";
  if (item.sensitive) {
    contentForSummary = redactSensitiveContent(contentForSummary);
  }

  const prompt = `Summarize this vault item for long-term memory storage.

Title: ${item.title}
Type: ${item.type}
Tags: ${item.tags.join(", ")}
Content:
${contentForSummary}

${levelInstructions[level]}${sensitiveNote}

Write ONLY the summary, no preamble:`;

  return generate(prompt, {
    temperature: 0.2,
    maxTokens: level === "detailed" ? 1000 : 300,
  });
}

/** Send a vault item summary to SuperMemory */
export async function sendToSupermemory(
  itemId: string,
  summary: string,
  level: SummaryLevel
): Promise<void> {
  const item = await getVaultItem(itemId);
  if (!item) throw new Error("Vault item not found");

  await addMemory(summary, {
    vault_item_id: item.id,
    vault_type: item.type,
    sensitive: item.sensitive,
    summary_level: level,
    source: "vault",
  });

  await updateVaultItem(itemId, {
    supermemoryStatus: "sent",
    supermemoryLevel: level,
    supermemorySummary: summary,
  });
}
