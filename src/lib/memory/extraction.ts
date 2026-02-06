import { appendToDailyNote } from './daily-notes';
import { emitMemoryEvent } from './events';
import { isOllamaAvailable, generate } from './ollama';

/**
 * Extract and save noteworthy information from a conversation turn.
 * This runs after the AI responds, analyzing what was discussed.
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  const startTime = Date.now();
  const useOllama = await isOllamaAvailable();
  let entry: string;
  let method: 'ollama' | 'fallback';

  if (useOllama) {
    entry = await extractSemanticNote(userMessage, assistantResponse);
    method = 'ollama';
  } else {
    entry = formatConversationEntry(userMessage, assistantResponse);
    method = 'fallback';
  }

  await appendToDailyNote(entry);

  emitMemoryEvent({
    eventType: 'extract',
    trigger: 'chat',
    summary: `Chat extraction (${method}): ${entry.slice(0, 80)}...`,
    payload: {
      userMessage: userMessage.slice(0, 500),
      assistantResponse: assistantResponse.slice(0, 500),
      extractedEntry: entry,
      method,
    },
    durationMs: Date.now() - startTime,
    metadata: { method },
  }).catch(() => {});
}

/**
 * Use Ollama to extract a semantic summary of the conversation
 */
async function extractSemanticNote(
  userMessage: string,
  assistantResponse: string
): Promise<string> {
  const prompt = `You are summarizing a conversation for memory storage. Extract the key information.

User said: "${userMessage.slice(0, 1000)}"

Assistant replied: "${assistantResponse.slice(0, 1000)}"

Write a brief note (2-4 sentences) capturing the key facts, decisions, or information shared. Focus on:
- Names of people, companies, projects mentioned
- Decisions made or preferences expressed
- Important facts or context shared
- Action items or follow-ups

Write ONLY the note, no introduction. Start with the main topic:`;

  try {
    const response = await generate(prompt, { temperature: 0.2, maxTokens: 300 });
    const note = response.trim();

    // Validate we got something useful
    if (note.length > 20 && note.length < 1000) {
      return note;
    }
  } catch (error) {
    console.error('[Extraction] Ollama failed, using fallback:', error);
  }

  // Fallback to simple format
  return formatConversationEntry(userMessage, assistantResponse);
}

function formatConversationEntry(
  userMessage: string,
  assistantResponse: string
): string {
  // Truncate very long messages
  const maxLength = 500;
  const truncatedUser = userMessage.length > maxLength
    ? userMessage.slice(0, maxLength) + '...'
    : userMessage;
  const truncatedAssistant = assistantResponse.length > maxLength
    ? assistantResponse.slice(0, maxLength) + '...'
    : assistantResponse;

  return `**User:** ${truncatedUser}

**Aurelius:** ${truncatedAssistant}`;
}
