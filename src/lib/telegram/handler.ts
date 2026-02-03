/**
 * Telegram Message Handler for Aurelius
 *
 * Full integration with Aurelius HQ - same AI, memory, tools, and conversation storage
 */

import { chatStreamWithTools, type Message } from '@/lib/ai/client';
import { buildAgentContext } from '@/lib/ai/context';
import { extractAndSaveMemories, containsMemorableContent } from '@/lib/memory/extraction';
import { db } from '@/lib/db';
import { conversations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  sendMessage,
  sendTypingAction,
  splitMessage,
  type TelegramUpdate,
  type TelegramMessage,
} from './client';

// Stored message type (matches web chat format)
type StoredMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

// Use a shared conversation ID so Telegram and web chat share history
// This ensures all messages appear in both interfaces
// Using a fixed UUID since the database column is uuid type
const SHARED_CONVERSATION_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Get conversation history from the database
 */
async function getConversationHistory(
  conversationId: string
): Promise<StoredMessage[]> {
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv) {
      return (conv.messages as StoredMessage[]) || [];
    }
  } catch (error) {
    console.error('Failed to get conversation history:', error);
  }
  return [];
}

/**
 * Save conversation to the database
 */
async function saveConversation(
  conversationId: string,
  messages: StoredMessage[]
): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (existing) {
      await db
        .update(conversations)
        .set({
          messages: messages,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    } else {
      await db.insert(conversations).values({
        id: conversationId,
        messages: messages,
      });
    }
  } catch (error) {
    console.error('Failed to save conversation:', error);
  }
}

/**
 * Handle a /start command
 */
async function handleStartCommand(message: TelegramMessage): Promise<void> {
  const welcomeText = `Hello${message.from?.first_name ? ` ${message.from.first_name}` : ''}! I'm Aurelius, your AI assistant.

I have full access to your HQ - memories, triage, and more. I can help you with:
• Questions and conversations (with full memory context)
• Managing your knowledge and notes
• Accessing and updating your configuration

Commands:
/start - Show this message
/clear - Clear conversation history
/help - Get help

Just send me a message to start chatting!`;

  await sendMessage(message.chat.id, welcomeText);
}

/**
 * Handle a /clear command
 */
async function handleClearCommand(message: TelegramMessage): Promise<void> {
  const conversationId = SHARED_CONVERSATION_ID;
  await saveConversation(conversationId, []);
  await sendMessage(message.chat.id, '✓ Conversation history cleared. Fresh start!');
}

/**
 * Handle a /help command
 */
async function handleHelpCommand(message: TelegramMessage): Promise<void> {
  const helpText = `*Aurelius Help*

I'm your AI assistant with full access to HQ:

*Memory:* I remember our conversations and can search your knowledge base

*Configuration:* I can view and propose changes to my own behavior

*Commands:*
/start - Welcome message
/clear - Clear conversation history
/help - This help message

Just chat naturally - I have the same capabilities as the web interface.`;

  await sendMessage(message.chat.id, helpText, { parseMode: 'Markdown' });
}

/**
 * Handle a regular chat message - full Aurelius integration
 */
async function handleChatMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const userText = message.text || '';

  if (!userText.trim()) {
    return;
  }

  // Start typing indicator immediately and keep it active throughout processing
  // Telegram typing indicator expires after 5 seconds, so we refresh every 3 seconds
  sendTypingAction(chatId).catch(() => {});
  const typingInterval = setInterval(() => {
    sendTypingAction(chatId).catch(() => {});
  }, 3000);

  const conversationId = SHARED_CONVERSATION_ID;

  try {
    // Get conversation history from database
    const storedHistory = await getConversationHistory(conversationId);

    // Convert stored history to AI message format
    const aiHistory: Message[] = storedHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Build agent context with Telegram-specific additions
    const telegramContext = `## Telegram Context
You're responding via Telegram. Keep responses concise and mobile-friendly.
The user is ${message.from?.first_name || 'a user'}${message.from?.username ? ` (@${message.from.username})` : ''}.`;

    const { systemPrompt: telegramPrompt } = await buildAgentContext({
      query: userText,
      additionalContext: telegramContext,
    });

    // Build messages for AI
    const aiMessages: Message[] = [...aiHistory, { role: 'user', content: userText }];

    // Collect the full response from the streaming API
    let fullResponse = '';

    for await (const event of chatStreamWithTools(
      aiMessages,
      telegramPrompt,
      conversationId
    )) {
      if (event.type === 'text') {
        fullResponse += event.content;
      }
      // Tool use/results are handled internally, we just collect the text output
    }

    // If no response, provide a fallback
    if (!fullResponse.trim()) {
      fullResponse = "I processed your message but didn't have a response. Could you rephrase?";
    }

    // Save the conversation to the database
    const newStoredMessages: StoredMessage[] = [
      ...storedHistory,
      {
        role: 'user',
        content: userText,
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString(),
      },
    ];

    await saveConversation(conversationId, newStoredMessages);

    // Extract and save memories if the message contains memorable content
    if (containsMemorableContent(userText)) {
      try {
        await extractAndSaveMemories(userText, fullResponse);
      } catch (error) {
        console.error('Failed to extract memories:', error);
      }
    }

    // Split long messages and send
    const chunks = splitMessage(fullResponse);
    for (const chunk of chunks) {
      await sendMessage(chatId, chunk);
    }
  } catch (error) {
    console.error('Error processing Telegram message:', error);
    await sendMessage(
      chatId,
      "I'm sorry, I encountered an error processing your message. Please try again."
    );
  } finally {
    // Always clear the typing indicator
    clearInterval(typingInterval);
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
