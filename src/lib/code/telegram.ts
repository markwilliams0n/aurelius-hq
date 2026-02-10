/**
 * Telegram Notifications for Code Sessions
 *
 * Handles formatting and sending/editing session status messages
 * in Telegram. Decoupled from session lifecycle logic.
 */

import {
  sendOwnerMessage,
  editOwnerMessage,
  type InlineKeyboardMarkup,
} from '@/lib/telegram/client';
import {
  getTelegramMessageId,
  setTelegramMessage,
} from './session-manager';

// ---------------------------------------------------------------------------
// Keyboard builders
// ---------------------------------------------------------------------------

/** Build inline keyboard buttons appropriate for the session state. */
export function getSessionKeyboard(
  state: 'running' | 'waiting' | 'completed' | 'error',
  cardId: string,
): InlineKeyboardMarkup | undefined {
  switch (state) {
    case 'running':
      return { inline_keyboard: [[{ text: '\u{1F6D1} Stop', callback_data: `code:stop:${cardId}` }]] };
    case 'waiting':
      return { inline_keyboard: [
        [{ text: '\u{1F6D1} Stop', callback_data: `code:stop:${cardId}` }],
      ] };
    case 'completed':
      return { inline_keyboard: [
        [{ text: '\u{25B6}\u{FE0F} Resume', callback_data: `code:resume:${cardId}` }],
        [
          { text: '\u{2705} Approve & Merge', callback_data: `code:approve:${cardId}` },
          { text: '\u{274C} Reject', callback_data: `code:reject:${cardId}` },
        ],
      ] };
    case 'error':
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/** Format a session status message for Telegram. */
export function formatSessionTelegram(
  state: 'running' | 'waiting' | 'completed' | 'error',
  task: string,
  totalTurns: number,
  totalCostUsd: number | null,
  extra?: { lastMessage?: string; error?: string; filesChanged?: number },
): string {
  const emoji = { running: '\u{1F7E1}', waiting: '\u{1F535}', completed: '\u{1F7E2}', error: '\u{1F534}' }[state];
  const label = { running: 'Running', waiting: 'Needs Response', completed: 'Completed', error: 'Failed' }[state];
  const truncatedTask = task.length > 50 ? task.slice(0, 47) + '...' : task;
  const costStr = totalCostUsd !== null ? `$${totalCostUsd.toFixed(2)}` : '...';

  const lines: string[] = [];
  lines.push(`${emoji} Coding: ${label}`);
  lines.push('');
  lines.push(`Task: ${truncatedTask}`);
  lines.push(`Turns: ${totalTurns} \u{00B7} Cost: ${costStr}`);

  if (state === 'waiting' && extra?.lastMessage) {
    const preview = extra.lastMessage.length > 1000 ? extra.lastMessage.slice(0, 997) + '...' : extra.lastMessage;
    lines.push('');
    lines.push(`Claude says:\n${preview}`);
    lines.push('');
    lines.push('\u{1F4AC} Reply to this message to respond.');
  } else if (state === 'error' && extra?.error) {
    lines.push('');
    lines.push(`Error: ${extra.error}`);
  } else if (state === 'completed' && extra?.filesChanged !== undefined) {
    lines.push(`Files changed: ${extra.filesChanged}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Send / edit
// ---------------------------------------------------------------------------

/** Send or edit the Telegram status message for a session. */
export async function updateSessionTelegram(
  sessionId: string,
  text: string,
  keyboard?: InlineKeyboardMarkup,
): Promise<void> {
  try {
    const existingMsgId = getTelegramMessageId(sessionId);
    if (existingMsgId) {
      const newId = await editOwnerMessage(existingMsgId, text, { replyMarkup: keyboard });
      if (newId && newId !== existingMsgId) {
        setTelegramMessage(sessionId, newId);
      }
    } else {
      const msgId = await sendOwnerMessage(text, { replyMarkup: keyboard });
      if (msgId) {
        setTelegramMessage(sessionId, msgId);
      }
    }
  } catch {
    // Best effort — don't fail the session over Telegram issues
  }
}

// ---------------------------------------------------------------------------
// Convenience: notify session state change
// ---------------------------------------------------------------------------

/** Send a Telegram notification for a session state change. Fire-and-forget — the
 *  underlying updateSessionTelegram is async but wrapped in try/catch, so callers
 *  don't need to await. */
export function notifySessionState(
  sessionId: string,
  state: 'running' | 'waiting' | 'completed' | 'error',
  cardId: string | undefined,
  task: string,
  totalTurns: number,
  totalCostUsd: number | null,
  extra?: { lastMessage?: string; error?: string; filesChanged?: number },
): void {
  updateSessionTelegram(
    sessionId,
    formatSessionTelegram(state, task, totalTurns, totalCostUsd, extra),
    cardId ? getSessionKeyboard(state, cardId) : undefined,
  );
}
