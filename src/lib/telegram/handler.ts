/**
 * Telegram Message Handler for Aurelius
 *
 * Processes incoming Telegram messages and routes them to the AI chat
 */

import { chat } from '@/lib/ai/client';
import { getMemoryContext } from '@/lib/memory/facts';
import {
  sendMessage,
  sendTypingAction,
  splitMessage,
  type TelegramUpdate,
  type TelegramMessage,
} from './client';

// Simple in-memory conversation store for context
// In production, you'd want to persist this
const conversationHistory = new Map<
  number,
  Array<{ role: 'user' | 'assistant'; content: string }>
>();

const MAX_HISTORY_LENGTH = 20;

/**
 * Get conversation history for a chat
 */
function getHistory(
  chatId: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return conversationHistory.get(chatId) || [];
}

/**
 * Add a message to conversation history
 */
function addToHistory(
  chatId: number,
  role: 'user' | 'assistant',
  content: string
): void {
  const history = getHistory(chatId);
  history.push({ role, content });

  // Trim history to max length
  while (history.length > MAX_HISTORY_LENGTH) {
    history.shift();
  }

  conversationHistory.set(chatId, history);
}

/**
 * Clear conversation history for a chat
 */
function clearHistory(chatId: number): void {
  conversationHistory.delete(chatId);
}

/**
 * Handle a /start command
 */
async function handleStartCommand(message: TelegramMessage): Promise<void> {
  const welcomeText = `Hello${message.from?.first_name ? ` ${message.from.first_name}` : ''}! I'm Aurelius, your AI assistant.

I can help you with questions, tasks, and conversations. Here are some commands:

/start - Show this welcome message
/clear - Clear conversation history
/help - Get help

Just send me a message to start chatting!`;

  await sendMessage(message.chat.id, welcomeText);
}

/**
 * Handle a /clear command
 */
async function handleClearCommand(message: TelegramMessage): Promise<void> {
  clearHistory(message.chat.id);
  await sendMessage(message.chat.id, '✓ Conversation history cleared. Fresh start!');
}

/**
 * Handle a /help command
 */
async function handleHelpCommand(message: TelegramMessage): Promise<void> {
  const helpText = `*Aurelius Help*

I'm an AI assistant that can help you with:
• Answering questions
• Having conversations
• Providing information

*Commands:*
/start - Welcome message
/clear - Clear conversation history
/help - This help message

*Tips:*
• Just type naturally to chat with me
• I remember our conversation context
• Use /clear to start fresh if needed`;

  await sendMessage(message.chat.id, helpText, { parseMode: 'Markdown' });
}

/**
 * Handle a regular chat message
 */
async function handleChatMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const userText = message.text || '';

  if (!userText.trim()) {
    return;
  }

  // Show typing indicator
  await sendTypingAction(chatId);

  try {
    // Get conversation history
    const history = getHistory(chatId);

    // Get memory context
    const memoryContext = await getMemoryContext();

    // Build system prompt with memory
    const systemPrompt = `You are Aurelius, a helpful AI assistant accessible via Telegram.

Keep your responses concise and mobile-friendly since users are on Telegram.
Be helpful, friendly, and to the point.

${memoryContext ? `\nHere is some context about the user and their preferences:\n${memoryContext}` : ''}`;

    // Add user message to history
    addToHistory(chatId, 'user', userText);

    // Build messages array (get fresh history after adding user message)
    const updatedHistory = getHistory(chatId);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...updatedHistory.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
    ];

    // Get AI response (non-streaming for Telegram)
    const response = await chat(messages);

    // Add assistant response to history
    addToHistory(chatId, 'assistant', response);

    // Split long messages and send
    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await sendMessage(chatId, chunk);
    }
  } catch (error) {
    console.error('Error processing Telegram message:', error);
    await sendMessage(
      chatId,
      "I'm sorry, I encountered an error processing your message. Please try again."
    );
  }
}

/**
 * Main handler for Telegram webhook updates
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;

  if (!message || !message.text) {
    return;
  }

  const text = message.text.trim();

  // Handle commands
  if (text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/start':
        await handleStartCommand(message);
        return;
      case '/clear':
        await handleClearCommand(message);
        return;
      case '/help':
        await handleHelpCommand(message);
        return;
      default:
        // Unknown command - treat as regular message
        break;
    }
  }

  // Handle regular chat message
  await handleChatMessage(message);
}
