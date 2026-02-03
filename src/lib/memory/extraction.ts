import { appendToDailyNote } from './daily-notes';
import { isOllamaAvailable, generate } from './ollama';

/**
 * Extract and save noteworthy information from a conversation turn.
 * This runs after the AI responds, analyzing what was discussed.
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  // Try to use Ollama for semantic extraction
  const useOllama = await isOllamaAvailable();

  if (useOllama) {
    const entry = await extractSemanticNote(userMessage, assistantResponse);
    await appendToDailyNote(entry);
  } else {
    // Fallback to simple formatting
    const entry = formatConversationEntry(userMessage, assistantResponse);
    await appendToDailyNote(entry);
  }
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

/**
 * Check if a message contains information worth persisting.
 * Used to avoid logging purely transactional exchanges.
 */
export function containsMemorableContent(message: string): boolean {
  // Simple heuristics - can be enhanced later
  const patterns = [
    /\b(?:my|i|we|our)\b.*\b(?:friend|colleague|boss|partner|wife|husband|brother|sister|mom|dad|mother|father)\b/i,
    /\b(?:works?|working)\s+(?:at|for|on)\b/i,
    /\b(?:lives?|living)\s+in\b/i,
    /\b(?:project|company|team)\b/i,
    /\b(?:prefer|like|want|need|always|never)\b/i,
    /\b(?:remember|don't forget|note that)\b/i,
    /\b(?:meeting|call|appointment)\b/i,
    /\b(?:birthday|anniversary|deadline)\b/i,
    /\b(?:email|phone|address)\b/i,
  ];

  return patterns.some(p => p.test(message));
}
