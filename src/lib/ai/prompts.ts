// System prompt for chat with memory extraction
export const CHAT_SYSTEM_PROMPT = `You are Aurelius, a personal AI assistant with persistent memory. You help the user manage their communications, tasks, and knowledge.

Your personality:
- Thoughtful and direct
- Stoic yet warm
- Concise but thorough when needed

## Memory Extraction

As you converse, extract noteworthy facts about people, projects, companies, and preferences. Output extracted facts at the END of your response in this format:

<memory>
- entity: [Name] | type: [person|project|topic|company|team] | fact: [atomic fact] | category: [preference|relationship|status|context|milestone]
</memory>

Only extract facts that are:
- Explicitly stated or clearly implied
- Worth remembering for future conversations
- Not already known (check the context provided)

If there's nothing new to remember, omit the <memory> block entirely.

## Response Format

Always structure your response as:

<reply>
Your conversational response here...
</reply>

<memory>
(optional - only if there are facts to extract)
</memory>
`;

// Build the full prompt with memory context
export function buildChatPrompt(
  memoryContext: string | null,
  soulConfig: string | null
): string {
  let prompt = CHAT_SYSTEM_PROMPT;

  if (soulConfig) {
    prompt += `\n\n## Your Soul Configuration\n\n${soulConfig}`;
  }

  if (memoryContext) {
    prompt += `\n\n## Relevant Memory Context\n\n${memoryContext}`;
  }

  return prompt;
}

// Parse the response to extract reply and memory blocks
export function parseResponse(response: string): {
  reply: string;
  memories: Array<{
    entity: string;
    type: string;
    fact: string;
    category: string;
  }>;
} {
  // Extract reply block
  const replyMatch = response.match(/<reply>([\s\S]*?)<\/reply>/);
  const reply = replyMatch ? replyMatch[1].trim() : response.trim();

  // Extract memory block
  const memoryMatch = response.match(/<memory>([\s\S]*?)<\/memory>/);
  const memories: Array<{
    entity: string;
    type: string;
    fact: string;
    category: string;
  }> = [];

  if (memoryMatch) {
    const memoryBlock = memoryMatch[1];
    const lines = memoryBlock.split("\n").filter((l) => l.trim().startsWith("-"));

    for (const line of lines) {
      // Parse: - entity: X | type: Y | fact: Z | category: W
      const parts = line
        .replace(/^-\s*/, "")
        .split("|")
        .map((p) => p.trim());

      const parsed: Record<string, string> = {};
      for (const part of parts) {
        const [key, ...valueParts] = part.split(":");
        if (key && valueParts.length > 0) {
          parsed[key.trim().toLowerCase()] = valueParts.join(":").trim();
        }
      }

      if (parsed.entity && parsed.type && parsed.fact) {
        memories.push({
          entity: parsed.entity,
          type: parsed.type,
          fact: parsed.fact,
          category: parsed.category || "context",
        });
      }
    }
  }

  return { reply, memories };
}
