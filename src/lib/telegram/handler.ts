/**
 * Telegram Message Handler for Aurelius
 *
 * Full integration with Aurelius HQ - same AI, memory, tools, and conversation storage
 */

import { chatStreamWithTools, type Message } from '@/lib/ai/client';
import { buildAgentContext } from '@/lib/ai/context';
import { extractAndSaveMemories } from '@/lib/memory/extraction';
import { db } from '@/lib/db';
import { conversations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  sendMessage,
  sendTypingAction,
  splitMessage,
  setOwnerChatId,
  type TelegramUpdate,
  type TelegramMessage,
} from './client';
import {
  createCard,
  generateCardId,
  getPendingCards,
  updateCard,
} from '@/lib/action-cards/db';
import { dispatchCardAction } from '@/lib/action-cards/registry';
import type { ActionCardData, CardPattern } from '@/lib/types/action-card';

// Register all card handlers so dispatchCardAction can find them
import '@/lib/action-cards/handlers/code';
import '@/lib/action-cards/handlers/slack';
import '@/lib/action-cards/handlers/vault';
import '@/lib/action-cards/handlers/config';
import '@/lib/action-cards/handlers/gmail';
import '@/lib/action-cards/handlers/linear';

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

// ---------------------------------------------------------------------------
// Action card support — format cards as Telegram text, handle text approval
// ---------------------------------------------------------------------------

const APPROVE_WORDS = new Set(['approve', 'start', 'confirm', 'yes']);
const DISMISS_WORDS = new Set(['reject', 'dismiss', 'cancel', 'no']);

/** Pattern-specific emoji for card messages */
const PATTERN_EMOJI: Record<string, string> = {
  code: '\u{1F527}',       // 🔧
  approval: '\u{2709}',    // ✉
  config: '\u{2699}',      // ⚙
  vault: '\u{1F512}',      // 🔒
  info: '\u{2139}',        // ℹ
};

/**
 * Format an action card as a decorated Telegram message.
 */
function formatCardForTelegram(card: ActionCardData): string {
  const emoji = PATTERN_EMOJI[card.pattern] ?? '\u{1F4CB}'; // 📋 fallback
  const data = card.data as Record<string, unknown>;
  const lines: string[] = [];

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`${emoji} *${escapeMd(card.title)}*`);
  lines.push('');

  // Pattern-specific details
  if (card.pattern === 'code') {
    if (data.task) lines.push(`Task: ${escapeMd(String(data.task))}`);
    if (data.branchName) lines.push(`Branch: \`${data.branchName}\``);
  } else if (data.message) {
    // Slack / approval cards with a message body
    const preview = String(data.message);
    lines.push(`Message: ${escapeMd(preview.length > 200 ? preview.slice(0, 197) + '...' : preview)}`);
    if (data.recipientName) lines.push(`To: ${escapeMd(String(data.recipientName))}`);
  } else if (data.key) {
    // Config cards
    lines.push(`Key: \`${data.key}\``);
    if (data.value !== undefined) lines.push(`Value: \`${String(data.value)}\``);
  }

  lines.push('');
  lines.push('Reply *approve* to confirm or *dismiss* to cancel.');
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/** Escape special Markdown characters for Telegram Markdown mode */
function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Handle text-based card approval/rejection from Telegram.
 * Finds the most recent pending card and dispatches the action.
 */
async function handleCardCommand(
  message: TelegramMessage,
  command: string,
): Promise<void> {
  const chatId = message.chat.id;
  const isApprove = APPROVE_WORDS.has(command);

  try {
    const pendingCards = await getPendingCards();
    if (pendingCards.length === 0) {
      await sendMessage(chatId, 'No pending actions to approve.');
      return;
    }

    const card = pendingCards[0]; // Most recent
    const action = isApprove ? 'confirm' : 'dismiss';
    const cardData = { ...card.data, _cardId: card.id, _confirmed: true };

    const result = await dispatchCardAction(card.handler, action, cardData);

    await updateCard(card.id, {
      status: result.status === 'needs_confirmation' ? 'pending' : result.status,
      ...(result.result && { result: result.result }),
    });

    if (result.status === 'error') {
      const err = (result.result?.error as string) || 'Unknown error';
      await sendMessage(chatId, `Action failed: ${err}`);
    } else if (result.status === 'dismissed') {
      await sendMessage(chatId, `Dismissed: ${card.title}`);
    } else {
      const msg = result.successMessage || 'Action confirmed';
      await sendMessage(chatId, `\u{2705} ${msg}`); // ✅
    }
  } catch (error) {
    console.error('[telegram] Card command error:', error);
    await sendMessage(chatId, 'Failed to process action. Check the web UI.');
  }
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

    // Collect text response and detect action cards from tool results
    let fullResponse = '';
    const collectedCards: ActionCardData[] = [];

    for await (const event of chatStreamWithTools(
      aiMessages,
      telegramPrompt,
      conversationId
    )) {
      if (event.type === 'text') {
        fullResponse += event.content;
      } else if (event.type === 'tool_result') {
        try {
          const parsed = JSON.parse(event.result);
          if (parsed.action_card) {
            const ac = parsed.action_card;
            const card = await createCard({
              id: generateCardId(),
              conversationId,
              pattern: (ac.pattern || 'approval') as CardPattern,
              status: 'pending',
              title: ac.title || 'Action',
              data: ac.data || {},
              handler: ac.handler || null,
            });
            collectedCards.push(card);
          }
        } catch {
          // Not JSON or no action_card — that's fine
        }
      }
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

    // Extract and save memories — let extraction decide what's notable
    try {
      await extractAndSaveMemories(userText, fullResponse);
    } catch (error) {
      console.error('Failed to extract memories:', error);
    }

    // Split long messages and send
    const chunks = splitMessage(fullResponse);
    for (const chunk of chunks) {
      await sendMessage(chatId, chunk);
    }

    // Send formatted card messages for any action cards created
    for (const card of collectedCards) {
      try {
        await sendMessage(chatId, formatCardForTelegram(card), { parseMode: 'MarkdownV2' });
      } catch (err) {
        // Fall back to plain text if Markdown formatting fails
        console.error('[telegram] Failed to send card with Markdown, retrying plain:', err);
        await sendMessage(chatId, `Action pending: ${card.title}\nReply "approve" to confirm or "dismiss" to cancel.`);
      }
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

  // Remember the owner's chat ID for proactive notifications
  setOwnerChatId(message.chat.id);

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

  // Check for card action commands (approve/dismiss pending actions)
  const lower = text.toLowerCase();
  if (APPROVE_WORDS.has(lower) || DISMISS_WORDS.has(lower)) {
    await handleCardCommand(message, lower);
    return;
  }

  // Handle regular chat message
  await handleChatMessage(message);
}
