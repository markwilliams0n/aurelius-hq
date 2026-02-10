/**
 * Code Session Manager
 *
 * Encapsulates runtime state for active coding sessions:
 * - ActiveSession tracking (process handles, state)
 * - Telegram message ID mapping (session ↔ message)
 * - SIGTERM cleanup
 * - Zombie session detection
 *
 * All maps are stored on globalThis to survive Next.js HMR reloads.
 */

import type { ActiveSession } from './executor';
import { getCard, updateCard } from '@/lib/action-cards/db';
import {
  getWorktreeStats,
  getChangedFiles,
  getWorktreeLog,
  worktreeExists,
} from './worktree';

// ---------------------------------------------------------------------------
// Global state — survives Next.js HMR
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as {
  __codeActiveSessions?: Map<string, ActiveSession>;
  __codeTelegramMessages?: Map<string, number>;
  __codeTelegramToSession?: Map<number, string>;
  __codeSigtermRegistered?: boolean;
};

if (!globalStore.__codeActiveSessions) globalStore.__codeActiveSessions = new Map();
if (!globalStore.__codeTelegramMessages) globalStore.__codeTelegramMessages = new Map();
if (!globalStore.__codeTelegramToSession) globalStore.__codeTelegramToSession = new Map();

const activeSessions = globalStore.__codeActiveSessions;
const telegramMessages = globalStore.__codeTelegramMessages;
const telegramToSessionMap = globalStore.__codeTelegramToSession;

/**
 * Direct access to the telegramToSession Map.
 * Used by telegram/handler.ts for .get()/.set() — will be removed when
 * telegram handler is updated to use the function API instead.
 */
export const telegramToSession = telegramToSessionMap;

// Kill all active sessions on server shutdown
if (!globalStore.__codeSigtermRegistered) {
  globalStore.__codeSigtermRegistered = true;
  process.on('SIGTERM', () => {
    for (const [id, session] of activeSessions) {
      console.log(`[code-session] Killing session ${id} on SIGTERM`);
      session.kill();
    }
    activeSessions.clear();
  });
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/** Get all active sessions, pruning any whose process has exited. */
export function getActiveSessions(): Map<string, ActiveSession> {
  for (const [id, session] of activeSessions) {
    if (session.process && 'exitCode' in session.process && session.process.exitCode !== null) {
      activeSessions.delete(id);
    }
  }
  return activeSessions;
}

/** Get a single active session by ID. */
export function getSession(sessionId: string): ActiveSession | undefined {
  return getActiveSessions().get(sessionId);
}

/** Store an active session. */
export function setSession(sessionId: string, session: ActiveSession): void {
  activeSessions.set(sessionId, session);
}

/** Remove an active session. */
export function removeSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Telegram message mapping
// ---------------------------------------------------------------------------

/** Get the Telegram message ID for a session's status message. */
export function getTelegramMessageId(sessionId: string): number | undefined {
  return telegramMessages.get(sessionId);
}

/** Store a Telegram message ID for a session, updating reverse map. */
export function setTelegramMessage(sessionId: string, messageId: number): void {
  // Clean up old mapping if it existed
  const oldId = telegramMessages.get(sessionId);
  if (oldId !== undefined) {
    telegramToSessionMap.delete(oldId);
  }
  telegramMessages.set(sessionId, messageId);
  telegramToSessionMap.set(messageId, sessionId);
}

/** Look up which session a Telegram message belongs to. */
export function getSessionForTelegramMessage(messageId: number): string | undefined {
  return telegramToSessionMap.get(messageId);
}

// ---------------------------------------------------------------------------
// Zombie detection
// ---------------------------------------------------------------------------

/**
 * Auto-finalize a session whose process died but card still says running/waiting.
 * If the worktree exists, gathers stats and marks completed so user can approve/reject.
 */
export async function finalizeZombieSession(cardId: string): Promise<'completed' | 'error'> {
  const card = await getCard(cardId);
  if (!card) return 'error';

  const data = card.data as Record<string, unknown>;
  const wtPath = data.worktreePath as string;
  const sessionId = data.sessionId as string;

  if (!wtPath || !worktreeExists(sessionId)) return 'error';

  try {
    const stats = getWorktreeStats(wtPath);
    const changedFiles = getChangedFiles(wtPath);
    const log = getWorktreeLog(wtPath);

    await updateCard(cardId, {
      data: {
        ...data,
        state: 'completed',
        result: {
          sessionId,
          turns: data.totalTurns || 0,
          costUsd: data.totalCostUsd ?? null,
          stats,
          changedFiles,
          log,
        },
      },
    });

    return 'completed';
  } catch {
    return 'error';
  }
}
