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
  editMessage,
  sendTypingAction,
  splitMessage,
  answerCallbackQuery,
  setOwnerChatId,
  getOwnerChatId,
  type TelegramUpdate,
  type TelegramMessage,
  type InlineKeyboardMarkup,
} from './client';
import {
  createCard,
  generateCardId,
  getCard,
  getPendingCards,
  getActionableCodingSessions,
  updateCard,
} from '@/lib/action-cards/db';
import { dispatchCardAction } from '@/lib/action-cards/registry';
import type { ActionCardData, CardPattern } from '@/lib/types/action-card';
import {
  getActiveSessions,
  telegramToSession,
  getSessionKeyboard,
  formatSessionTelegram,
  finalizeZombieSession,
} from '@/lib/action-cards/handlers/code';

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
  const helpText = `Aurelius Help

Commands:
/pending - Show all pending actions & sessions
/approve - Approve most recent (or /approve 2 for #2)
/reject - Reject most recent (or /reject 2 for #2)
/clear - Clear conversation history

Session Control:
- Reply to a session message to answer Claude
- Use inline buttons to stop, approve, or reject
- /pending to recall all active sessions

Just chat naturally for anything else.`;

  await sendMessage(message.chat.id, helpText);
}

// ---------------------------------------------------------------------------
// Action card support — format cards as Telegram text, handle text approval
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Action card rendering — plain text + inline buttons (NO MarkdownV2)
// ---------------------------------------------------------------------------

/** Pattern-specific emoji for card messages */
const PATTERN_EMOJI: Record<string, string> = {
  code: '\u{1F527}',       // 🔧
  approval: '\u{2709}',    // ✉
  config: '\u{2699}',      // ⚙
  vault: '\u{1F512}',      // 🔒
  info: '\u{2139}',        // ℹ
  slack: '\u{1F4AC}',      // 💬
  gmail: '\u{1F4E7}',      // 📧
  linear: '\u{1F4CB}',     // 📋
};

/** Format any action card as plain text (no Markdown — never breaks). */
function formatCardPlainText(card: ActionCardData): string {
  const emoji = PATTERN_EMOJI[card.pattern] ?? '\u{1F4CB}';
  const data = card.data as Record<string, unknown>;
  const lines: string[] = [];

  lines.push(`${emoji} ${card.title}`);

  if (card.pattern === 'code') {
    if (data.task) {
      const task = String(data.task);
      lines.push(`Task: ${task.length > 100 ? task.slice(0, 97) + '...' : task}`);
    }
    if (data.branchName) lines.push(`Branch: ${data.branchName}`);
  } else if (data.message) {
    const preview = String(data.message);
    lines.push(preview.length > 200 ? preview.slice(0, 197) + '...' : preview);
    if (data.recipientName) lines.push(`To: ${data.recipientName}`);
  } else if (data.key) {
    lines.push(`Key: ${data.key}`);
    if (data.value !== undefined) lines.push(`Value: ${data.value}`);
  }

  return lines.join('\n');
}

/** Build inline keyboard for any pending action card. */
function getCardKeyboard(cardId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: '\u{2705} Approve', callback_data: `card:approve:${cardId}` },
      { text: '\u{274C} Reject', callback_data: `card:reject:${cardId}` },
    ]],
  };
}

// ---------------------------------------------------------------------------
// /approve [n] and /reject [n] — targeted card commands
// ---------------------------------------------------------------------------

/** Stored from last /pending call so /approve N works. */
const pendingListStore = globalThis as unknown as { __pendingCardList?: ActionCardData[] };

async function handleApproveRejectCommand(
  message: TelegramMessage,
  action: 'approve' | 'reject',
  arg?: string,
): Promise<void> {
  const chatId = message.chat.id;

  try {
    const pendingCards = await getPendingCards();
    const codingSessions = await getActionableCodingSessions();
    const allActionable = [...pendingCards, ...codingSessions];

    if (allActionable.length === 0) {
      await sendMessage(chatId, 'Nothing pending to approve or reject.');
      return;
    }

    // Determine which card to act on
    let card: ActionCardData;
    if (arg && /^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1; // 1-indexed
      const list = pendingListStore.__pendingCardList ?? allActionable;
      if (idx < 0 || idx >= list.length) {
        await sendMessage(chatId, `Invalid number. Use 1-${list.length}.`);
        return;
      }
      card = list[idx];
    } else {
      card = allActionable[0]; // Most recent
    }

    const isCodeSession = card.pattern === 'code' && card.status === 'confirmed';
    const data = card.data as Record<string, unknown>;

    // Route to appropriate handler
    let handler: string;
    let dispatchAction: string;
    if (isCodeSession && action === 'approve') {
      handler = 'code:approve';
      dispatchAction = 'confirm';
    } else if (isCodeSession && action === 'reject') {
      handler = 'code:reject';
      dispatchAction = 'confirm';
    } else {
      handler = card.handler || '';
      dispatchAction = action === 'approve' ? 'confirm' : 'dismiss';
    }

    const cardData = { ...data, _cardId: card.id, _confirmed: true };
    const result = await dispatchCardAction(handler, dispatchAction, cardData);

    await updateCard(card.id, {
      status: result.status === 'needs_confirmation' ? 'pending' : result.status,
      ...(result.result && { result: result.result }),
    });

    if (result.status === 'error') {
      const err = (result.result?.error as string) || 'Unknown error';
      await sendMessage(chatId, `Failed: ${err}`);
    } else if (result.status === 'dismissed') {
      await sendMessage(chatId, `\u{274C} Rejected: ${card.title}`);
    } else {
      await sendMessage(chatId, `\u{2705} ${result.successMessage || 'Done'}: ${card.title}`);
    }
  } catch (error) {
    console.error('[telegram] Approve/reject error:', error);
    await sendMessage(chatId, 'Failed to process. Try /pending to refresh.');
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
The user is ${message.from?.first_name || 'a user'}${message.from?.username ? ` (@${message.from.username})` : ''}.

IMPORTANT: When the user asks about pending actions, approvals, sessions, or status,
use the check_coding_sessions tool. After your response, the system will automatically
send interactive cards with buttons the user can tap. Do NOT tell the user to use commands
or that cards aren't available — they will be sent automatically.`;

    const { systemPrompt: telegramPrompt } = await buildAgentContext({
      query: userText,
      additionalContext: telegramContext,
    });

    // Build messages for AI
    const aiMessages: Message[] = [...aiHistory, { role: 'user', content: userText }];

    // Collect text response, detect action cards, and track tool usage
    let fullResponse = '';
    const collectedCards: ActionCardData[] = [];
    const toolsUsed = new Set<string>();

    for await (const event of chatStreamWithTools(
      aiMessages,
      telegramPrompt,
      conversationId
    )) {
      if (event.type === 'text') {
        fullResponse += event.content;
      } else if (event.type === 'tool_use') {
        toolsUsed.add(event.toolName);
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

    // Send action cards with plain text + inline buttons (never fails)
    for (const card of collectedCards) {
      const text = formatCardPlainText(card);
      const keyboard = getCardKeyboard(card.id);
      await sendMessage(chatId, text, { replyMarkup: keyboard });
    }

    // Auto-send pending items with buttons when relevant:
    // 1. AI explicitly called check_coding_sessions tool
    // 2. User's message mentions approval/session/status keywords
    // Belt-and-suspenders: even if AI doesn't call the right tool, keywords trigger it
    const sessionKeywords = /\b(approv|reject|pending|session|status|merge|code.?review|check.?session|what.?s.*running)\b/i;
    if (toolsUsed.has('check_coding_sessions') || sessionKeywords.test(userText)) {
      await sendPendingCardsWithButtons(chatId);
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

// ---------------------------------------------------------------------------
// Send pending cards with buttons — shared by /pending command and auto-send
// ---------------------------------------------------------------------------

async function sendPendingCardsWithButtons(chatId: number): Promise<void> {
  const pendingCards = await getPendingCards();
  const codingSessions = await getActionableCodingSessions();
  const liveSessionMap = getActiveSessions();

  // Build a unified list of all actionable items
  const allItems: ActionCardData[] = [];

  // Coding sessions first (most time-sensitive)
  for (const card of codingSessions) {
    allItems.push(card);
  }

  // Then pending cards (excluding code cards already shown as sessions)
  const sessionCardIds = new Set(codingSessions.map(c => c.id));
  for (const card of pendingCards) {
    if (!sessionCardIds.has(card.id)) {
      allItems.push(card);
    }
  }

  // Store for /approve N targeting
  pendingListStore.__pendingCardList = allItems;

  if (allItems.length === 0) return;

  // Send each item as its own message with buttons
  for (let i = 0; i < allItems.length; i++) {
    const card = allItems[i];
    const data = card.data as Record<string, unknown>;
    const num = i + 1;

    if (card.pattern === 'code' && card.status === 'confirmed') {
      // Coding session — use rich session format with session-specific buttons
      const state = data.state as 'running' | 'waiting' | 'completed' | 'error';
      const task = (data.task as string) || 'Unknown task';
      const totalTurns = (data.totalTurns as number) || 0;
      const totalCostUsd = (data.totalCostUsd as number) ?? null;
      const sessionId = data.sessionId as string;

      const liveSession = sessionId ? liveSessionMap.get(sessionId) : null;

      // Detect zombie: card says running/waiting but no active process
      const isZombie = !liveSession && (state === 'running' || state === 'waiting');
      let effectiveState: string;

      if (liveSession) {
        effectiveState = liveSession.state === 'waiting_for_input' ? 'waiting' : 'running';
      } else if (isZombie) {
        // Auto-finalize: check worktree for work done, mark as completed
        const finalized = await finalizeZombieSession(card.id);
        effectiveState = finalized; // 'completed' or 'error'
      } else {
        effectiveState = state;
      }

      // Skip error-state sessions entirely
      if (effectiveState === 'error') continue;

      const text = `#${num} ` + formatSessionTelegram(
        effectiveState as 'running' | 'waiting' | 'completed' | 'error',
        task,
        totalTurns,
        totalCostUsd,
        {
          lastMessage: effectiveState === 'waiting' ? (data.lastMessage as string) : undefined,
          filesChanged: effectiveState === 'completed'
            ? ((data.result as Record<string, unknown>)?.changedFiles as unknown[])?.length ?? 0
            : undefined,
        },
      );

      const keyboard = getSessionKeyboard(
        effectiveState as 'running' | 'waiting' | 'completed' | 'error',
        card.id,
      );

      const msg = await sendMessage(chatId, text, { replyMarkup: keyboard });

      if (sessionId && msg) {
        telegramToSession.set(msg.message_id, sessionId);
      }
    } else {
      // General pending card — plain text + approve/reject buttons
      const text = `#${num} ${formatCardPlainText(card)}`;
      const keyboard = getCardKeyboard(card.id);
      await sendMessage(chatId, text, { replyMarkup: keyboard });
    }
  }
}

// ---------------------------------------------------------------------------
// /pending (or /sessions, /status) — show ALL actionable items with buttons
// ---------------------------------------------------------------------------

async function handlePendingCommand(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;

  try {
    const allItems = [
      ...(await getActionableCodingSessions()),
      ...(await getPendingCards()),
    ];

    if (allItems.length === 0) {
      await sendMessage(chatId, 'Nothing pending. All clear.');
      return;
    }

    await sendMessage(chatId, `\u{1F4CB} ${allItems.length} actionable item${allItems.length > 1 ? 's' : ''}:`);
    await sendPendingCardsWithButtons(chatId);
  } catch (err) {
    console.error('[telegram] /pending error:', err);
    await sendMessage(chatId, 'Failed to fetch pending items. Try again.');
  }
}

// ---------------------------------------------------------------------------
// Callback query handler — inline keyboard button presses
// ---------------------------------------------------------------------------

async function handleCallbackQuery(
  callbackQueryId: string,
  data: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  // Format: "code:<action>:<cardId>" or "card:<action>:<cardId>"
  const parts = data.split(':');
  if (parts.length < 3) {
    await answerCallbackQuery(callbackQueryId, { text: 'Unknown action' });
    return;
  }

  const prefix = parts[0]; // "code" or "card"
  const action = parts[1]; // stop, approve, reject
  const cardId = parts.slice(2).join(':');

  try {
    const card = await getCard(cardId);
    if (!card) {
      await answerCallbackQuery(callbackQueryId, { text: 'Card not found' });
      return;
    }

    const cardData = { ...card.data, _cardId: cardId, _confirmed: true };

    let handler: string;
    let dispatchAction: string;

    if (prefix === 'code') {
      // Code session buttons — route to code:stop, code:approve, code:reject
      handler = `code:${action}`;
      dispatchAction = 'confirm';
    } else {
      // General card buttons — approve or reject
      handler = card.handler || '';
      dispatchAction = action === 'approve' ? 'confirm' : 'dismiss';
    }

    const result = await dispatchCardAction(handler, dispatchAction, cardData);

    if (result.status === 'error') {
      const err = (result.result?.error as string) || 'Unknown error';
      await answerCallbackQuery(callbackQueryId, { text: `Failed: ${err}`, showAlert: true });
    } else {
      const labels: Record<string, string> = {
        stop: 'Session stopped',
        approve: result.successMessage || 'Approved!',
        reject: result.successMessage || 'Rejected',
        resume: 'Session resumed',
      };
      await answerCallbackQuery(callbackQueryId, { text: labels[action] || 'Done' });

      // Don't change card status for resume (session handler manages it)
      if (action !== 'resume') {
        await updateCard(cardId, {
          status: result.status === 'needs_confirmation' ? 'pending' : result.status,
          ...(result.result && { result: result.result }),
        });
      }

      // Edit the message to show it's been handled
      const ownerChatId = getOwnerChatId();
      if (ownerChatId) {
        try {
          const emojiMap: Record<string, string> = {
            approve: '\u{2705}', reject: '\u{274C}', stop: '\u{1F6D1}', resume: '\u{25B6}\u{FE0F}',
          };
          const labelMap: Record<string, string> = {
            approve: 'Approved', reject: 'Rejected', stop: 'Stopped', resume: 'Resumed',
          };
          const emoji = emojiMap[action] || '\u{2705}';
          const label = labelMap[action] || 'Done';
          await editMessage(ownerChatId, messageId, `${emoji} ${label}: ${card.title}`);
        } catch {
          // Best effort — message may be too old
        }
      }
    }
  } catch (err) {
    console.error('[telegram] Callback query error:', err);
    await answerCallbackQuery(callbackQueryId, { text: 'Error processing action', showAlert: true });
  }
}

// ---------------------------------------------------------------------------
// Reply-to-session handler — respond to coding session questions
// ---------------------------------------------------------------------------

async function handleSessionReply(
  message: TelegramMessage,
  sessionId: string,
): Promise<boolean> {
  const chatId = message.chat.id;
  const repliedMsgId = message.reply_to_message?.message_id;
  const sessions = getActiveSessions();
  const session = sessions.get(sessionId);

  if (!session) {
    await sendMessage(chatId, 'Session no longer active — it may have completed or been stopped.', {
      replyToMessageId: repliedMsgId,
    });
    return true;
  }

  if (session.state !== 'waiting_for_input') {
    await sendMessage(chatId, `Session is ${session.state}, not waiting for input.`, {
      replyToMessageId: repliedMsgId,
    });
    return true;
  }

  const text = message.text || '';
  session.sendMessage(text);
  await sendMessage(chatId, '\u{2705} Response sent — session resuming.', {
    replyToMessageId: repliedMsgId,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Main handler for Telegram webhook updates
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  // Handle inline keyboard button presses
  if (update.callback_query) {
    const cq = update.callback_query;
    if (cq.data && cq.message) {
      await handleCallbackQuery(
        cq.id,
        cq.data,
        cq.message.chat.id,
        cq.message.message_id,
      );
    }
    return;
  }

  const message = update.message;

  if (!message || !message.text) {
    return;
  }

  // Remember the owner's chat ID for proactive notifications
  setOwnerChatId(message.chat.id);

  // Check if this is a reply to a coding session status message
  if (message.reply_to_message) {
    const repliedMsgId = message.reply_to_message.message_id;
    const sessionId = telegramToSession.get(repliedMsgId);
    if (sessionId) {
      const handled = await handleSessionReply(message, sessionId);
      if (handled) return;
    }
  }

  const text = message.text.trim();

  // Handle commands
  if (text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();

    const arg = text.split(/\s+/)[1]; // optional argument after command

    switch (command) {
      case '/start':
        await handleStartCommand(message);
        return;
      case '/pending':
      case '/sessions':
      case '/status':
        await handlePendingCommand(message);
        return;
      case '/approve':
        await handleApproveRejectCommand(message, 'approve', arg);
        return;
      case '/reject':
        await handleApproveRejectCommand(message, 'reject', arg);
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
