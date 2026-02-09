/**
 * Telegram Bot Client for Aurelius
 *
 * Handles communication with the Telegram Bot API
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }
  return token;
}

function getApiUrl(method: string): string {
  return `${TELEGRAM_API_BASE}${getBotToken()}/${method}`;
}

/**
 * Send a message to a Telegram chat
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  options?: {
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    replyToMessageId?: number;
    disableNotification?: boolean;
  }
): Promise<TelegramMessage> {
  const response = await fetch(getApiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode,
      reply_to_message_id: options?.replyToMessageId,
      disable_notification: options?.disableNotification,
    }),
  });

  const data: TelegramApiResponse<TelegramMessage> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result!;
}

/**
 * Edit an existing message in a Telegram chat
 */
export async function editMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  options?: { parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
): Promise<TelegramMessage> {
  const response = await fetch(getApiUrl('editMessageText'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parseMode,
    }),
  });

  const data: TelegramApiResponse<TelegramMessage> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result!;
}

/**
 * Send a "typing" action to indicate the bot is processing
 */
export async function sendTypingAction(chatId: number | string): Promise<void> {
  await fetch(getApiUrl('sendChatAction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: 'typing',
    }),
  });
}

/**
 * Set the webhook URL for the bot
 */
export async function setWebhook(url: string): Promise<boolean> {
  const response = await fetch(getApiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message'],
    }),
  });

  const data: TelegramApiResponse<boolean> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to set webhook: ${data.description}`);
  }

  return data.result!;
}

/**
 * Delete the webhook (for switching to polling mode or cleanup)
 */
export async function deleteWebhook(): Promise<boolean> {
  const response = await fetch(getApiUrl('deleteWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drop_pending_updates: true,
    }),
  });

  const data: TelegramApiResponse<boolean> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to delete webhook: ${data.description}`);
  }

  return data.result!;
}

/**
 * Get current webhook info
 */
export async function getWebhookInfo(): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  const response = await fetch(getApiUrl('getWebhookInfo'));
  const data: TelegramApiResponse<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to get webhook info: ${data.description}`);
  }

  return data.result!;
}

/**
 * Get bot info
 */
export async function getMe(): Promise<TelegramUser> {
  const response = await fetch(getApiUrl('getMe'));
  const data: TelegramApiResponse<TelegramUser> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to get bot info: ${data.description}`);
  }

  return data.result!;
}

// ---------------------------------------------------------------------------
// Owner chat ID — for proactive notifications (coding sessions, alerts, etc.)
// ---------------------------------------------------------------------------

/** Cached chat ID from the most recent incoming Telegram message. */
let ownerChatId: number | null = null;

/** Call this whenever you receive a Telegram message to remember the chat ID. */
export function setOwnerChatId(chatId: number): void {
  ownerChatId = chatId;
}

/**
 * Get the owner's chat ID. Checks (in order):
 * 1. In-memory cache (set from last incoming Telegram message)
 * 2. TELEGRAM_CHAT_ID env var
 *
 * Returns null if neither is available.
 */
export function getOwnerChatId(): number | null {
  if (ownerChatId) return ownerChatId;
  const envId = process.env.TELEGRAM_CHAT_ID;
  if (envId) return parseInt(envId, 10);
  return null;
}

/**
 * Send a proactive notification to the owner.
 * Silently fails if no chat ID is available.
 */
export async function notifyOwner(
  text: string,
  options?: { parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
): Promise<void> {
  const chatId = getOwnerChatId();
  if (!chatId) {
    console.warn('[telegram] Cannot notify owner — no chat ID available. Set TELEGRAM_CHAT_ID or send a Telegram message first.');
    return;
  }
  try {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await sendMessage(chatId, chunk, options);
    }
  } catch (err) {
    console.error('[telegram] Failed to notify owner:', err);
  }
}

/**
 * Send a notification to the owner and return the message_id.
 * Used for messages that will be edited later (e.g. coding session status).
 * Returns null if sending fails.
 */
export async function sendOwnerMessage(text: string): Promise<number | null> {
  const chatId = getOwnerChatId();
  if (!chatId) {
    console.warn('[telegram] Cannot send owner message — no chat ID available.');
    return null;
  }
  try {
    const msg = await sendMessage(chatId, text);
    return msg.message_id;
  } catch (err) {
    console.error('[telegram] Failed to send owner message:', err);
    return null;
  }
}

/**
 * Edit an existing owner notification. Falls back to sending a new message
 * if editing fails (e.g. message too old or deleted).
 * Returns the message_id (possibly new if fallback was used).
 */
export async function editOwnerMessage(
  messageId: number,
  text: string,
): Promise<number | null> {
  const chatId = getOwnerChatId();
  if (!chatId) return null;
  try {
    await editMessage(chatId, messageId, text);
    return messageId;
  } catch (err) {
    // Telegram rejects edits if content is unchanged or message is too old
    console.error('[telegram] Failed to edit message, sending new:', err);
    return sendOwnerMessage(text);
  }
}

/**
 * Split a long message into chunks that fit Telegram's 4096 character limit
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Try to split at a space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Force split at maxLength
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
