import { appendToDailyNote } from './daily-notes';

/**
 * Extract and save noteworthy information from a conversation turn.
 * This runs after the AI responds, analyzing what was discussed.
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  // For now, just save the conversation exchange to daily notes
  // Later: use local LLM to extract structured facts

  const entry = formatConversationEntry(userMessage, assistantResponse);
  await appendToDailyNote(entry);
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
