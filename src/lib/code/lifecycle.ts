/**
 * Code Session Lifecycle
 *
 * Shared logic for starting and resuming coding sessions.
 * Eliminates duplication between the code:start and code:resume handlers.
 */

import { startSession, type ActiveSession } from './executor';
import { buildCodePrompt } from './prompts';
import {
  getWorktreeStats,
  getChangedFiles,
  getWorktreeLog,
} from './worktree';
import { setSession, removeSession } from './session-manager';
import { notifySessionState } from './telegram';
import { getCard, updateCard } from '@/lib/action-cards/db';
import type { CardHandlerResult } from '@/lib/action-cards/registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnSessionOptions {
  sessionId: string;
  task: string;
  context?: string | null;
  branchName: string;
  worktreePath: string;
  cardId?: string;
  cardData: Record<string, unknown>;
  /** If true, wraps the task/context for a resumed session. */
  isResume?: boolean;
  /** Initial turn count (for resumed sessions). */
  initialTurns?: number;
  /** Initial cost (for resumed sessions). */
  initialCost?: number | null;
  /** If true, skip worktree cleanup on error (resume keeps partial work). */
  keepWorktreeOnError?: boolean;
  /** Worktree cleanup function — only needed for start (not resume). */
  cleanupOnError?: () => void;
}

// ---------------------------------------------------------------------------
// Placeholder for reserving session slot
// ---------------------------------------------------------------------------

function createPlaceholder(): ActiveSession {
  return {
    pid: 0,
    kill: () => {},
    process: null as unknown,
    state: 'running' as const,
    sendMessage: () => {},
    closeInput: () => {},
  } as ActiveSession;
}

// ---------------------------------------------------------------------------
// Finalize session — gather worktree stats and mark completed
// ---------------------------------------------------------------------------

export async function finalizeSession(
  sessionId: string,
  cardId: string | undefined,
  data: Record<string, unknown>,
  worktreePath: string,
  totalTurns: number,
  totalCostUsd: number | null,
): Promise<void> {
  removeSession(sessionId);

  if (!cardId) return;

  try {
    const stats = getWorktreeStats(worktreePath);
    const changedFiles = getChangedFiles(worktreePath);
    const log = getWorktreeLog(worktreePath);

    const currentCard = await getCard(cardId);
    if (currentCard?.status === 'confirmed') {
      await updateCard(cardId, {
        data: {
          ...data,
          state: 'completed',
          worktreePath,
          totalTurns,
          totalCostUsd,
          result: {
            sessionId,
            turns: totalTurns,
            costUsd: totalCostUsd,
            stats,
            changedFiles,
            log,
          },
        },
      });
    }

    const task = (data.task as string) || 'Unknown task';
    notifySessionState(sessionId, 'completed', cardId, task, totalTurns, totalCostUsd, {
      filesChanged: changedFiles?.length ?? 0,
    });
  } catch (err) {
    console.error(`[code-session:${sessionId}] Failed to gather results:`, err);
  }
}

// ---------------------------------------------------------------------------
// Spawn session — shared by start and resume
// ---------------------------------------------------------------------------

export async function spawnSession(opts: SpawnSessionOptions): Promise<CardHandlerResult> {
  const {
    sessionId,
    task,
    context,
    branchName,
    worktreePath,
    cardId,
    cardData,
    isResume = false,
    initialTurns = 0,
    initialCost = null,
    keepWorktreeOnError = false,
    cleanupOnError,
  } = opts;

  // Reserve the session slot atomically
  setSession(sessionId, createPlaceholder());

  let totalTurns = initialTurns;
  let totalCostUsd = initialCost;

  // Build prompt
  const systemPrompt = isResume
    ? buildCodePrompt(task, [
        'RESUME: This session is being resumed from a previous run.',
        'The worktree already has work in progress.',
        'Check `git log --oneline main..HEAD` and `git status` to see what was done.',
        'Continue from where you left off.',
        context || '',
      ].filter(Boolean).join('\n'))
    : buildCodePrompt(task, context ?? undefined);

  const taskMessage = isResume
    ? `Continue working on: ${task}\n\nThis is a resumed session. Check git log and git status to see what was already done, then continue.`
    : task;

  let session: ActiveSession;
  try {
    session = startSession({
      sessionId,
      systemPrompt,
      task: taskMessage,
      worktreePath,

      onProgress(event) {
        console.log(`[code-session:${sessionId}] ${event.type}`, event.text ?? event.tool ?? '');
      },

      async onResult(result) {
        totalTurns = result.turns;
        if (result.costUsd !== null) totalCostUsd = result.costUsd;

        if (cardId) {
          try {
            const currentCard = await getCard(cardId);
            if (currentCard?.status === 'confirmed') {
              await updateCard(cardId, {
                data: {
                  ...cardData,
                  worktreePath,
                  state: 'waiting',
                  lastMessage: result.text,
                  totalTurns,
                  totalCostUsd,
                },
              });
            }
          } catch (err) {
            console.error(`[code-session:${sessionId}] Failed to update card:`, err);
          }
        }

        notifySessionState(sessionId, 'waiting', cardId, task, totalTurns, totalCostUsd, {
          lastMessage: result.text,
        });
      },

      async onError(error) {
        removeSession(sessionId);

        if (!keepWorktreeOnError) {
          cleanupOnError?.();
        }

        if (cardId) {
          try {
            await updateCard(cardId, {
              ...(keepWorktreeOnError
                ? { data: { ...cardData, state: 'error' } }
                : { status: 'error' }),
              result: { error: error.message },
            });
          } catch (err) {
            console.error(`[code-session:${sessionId}] Failed to update card on error:`, err);
          }
        }

        notifySessionState(sessionId, 'error', cardId, task, totalTurns, totalCostUsd, {
          error: error.message,
        });
      },
    });
  } catch (err) {
    removeSession(sessionId);
    if (!keepWorktreeOnError) {
      cleanupOnError?.();
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: `Failed to ${isResume ? 'resume' : 'start'} session: ${msg}` };
  }

  // Replace placeholder with real session
  setSession(sessionId, session);

  // Listen for process exit to finalize
  session.process.on('exit', () => {
    if (session.state === 'completed' || session.state === 'waiting_for_input') {
      finalizeSession(sessionId, cardId, cardData, worktreePath, totalTurns, totalCostUsd);
    }
  });

  // Update card to running state
  if (cardId) {
    await updateCard(cardId, {
      data: {
        ...cardData,
        worktreePath,
        state: 'running',
        totalTurns,
        totalCostUsd,
      },
    });
  }

  notifySessionState(sessionId, 'running', cardId, task, totalTurns, totalCostUsd);

  return { status: 'confirmed' };
}
