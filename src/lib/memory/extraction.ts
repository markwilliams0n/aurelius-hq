import { appendToDailyNote } from './daily-notes';
import { emitMemoryEvent } from './events';
import { addMemory } from './supermemory';

/**
 * Extract and save noteworthy information from a conversation turn.
 * This runs after the AI responds, analyzing what was discussed.
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  const startTime = Date.now();
  const entry = formatConversationEntry(userMessage, assistantResponse);

  await appendToDailyNote(entry);

  // Send to Supermemory for long-term memory (fire-and-forget)
  addMemory(
    `User: ${userMessage}\nAssistant: ${assistantResponse}`,
    { source: "chat" }
  ).catch((error) => {
    console.error('[Extraction] Supermemory add failed:', error);
    emitMemoryEvent({
      eventType: 'save',
      trigger: 'chat',
      summary: `Supermemory save failed: ${error instanceof Error ? error.message : String(error)}`,
      payload: { error: String(error), content: userMessage.slice(0, 200) },
      metadata: { status: 'error', method: 'supermemory' },
    }).catch(() => {});
  });

  emitMemoryEvent({
    eventType: 'extract',
    trigger: 'chat',
    summary: `Chat extraction: ${entry.slice(0, 80)}...`,
    payload: {
      userMessage: userMessage.slice(0, 500),
      assistantResponse: assistantResponse.slice(0, 500),
      extractedEntry: entry,
      method: 'supermemory',
    },
    durationMs: Date.now() - startTime,
    metadata: { method: 'supermemory' },
  }).catch(() => {});
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
