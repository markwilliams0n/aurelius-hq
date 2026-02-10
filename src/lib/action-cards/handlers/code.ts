import { registerCardHandler } from "../registry";
import {
  createWorktree,
  cleanupWorktree,
  mergeWorktree,
  getWorktreeStats,
  getChangedFiles,
  getWorktreeLog,
  worktreeExists,
} from "@/lib/code/worktree";
import { startSession, type ActiveSession } from "@/lib/code/executor";
import { buildCodePrompt } from "@/lib/code/prompts";
import { getCard, updateCard } from "../db";
import {
  sendOwnerMessage,
  editOwnerMessage,
  type InlineKeyboardMarkup,
} from "@/lib/telegram/client";
import {
  getActiveSessions,
  getSession as getActiveSession,
  setSession,
  removeSession,
  getTelegramMessageId,
  setTelegramMessage,
  getSessionForTelegramMessage,
  finalizeZombieSession,
} from "@/lib/code/session-manager";

// Re-export for consumers that import from this file
export { getActiveSessions, finalizeZombieSession, telegramToSession } from "@/lib/code/session-manager";

// ---------------------------------------------------------------------------
// Telegram session message — one message per session, edited on state changes
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
      return undefined; // No actions for failed sessions
  }
}

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
  lines.push(`Turns: ${totalTurns} · Cost: ${costStr}`);

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

/** Send or edit the Telegram status message for a session. */
async function updateSessionTelegram(
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
// Helpers
// ---------------------------------------------------------------------------

/** Gather final worktree stats and update the card as completed. */
async function finalizeSession(
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
    if (currentCard?.status === "confirmed") {
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

    // Update Telegram status message
    const task = (data.task as string) || 'Unknown task';
    updateSessionTelegram(
      sessionId,
      formatSessionTelegram('completed', task, totalTurns, totalCostUsd, {
        filesChanged: changedFiles?.length ?? 0,
      }),
      cardId ? getSessionKeyboard('completed', cardId) : undefined,
    );
  } catch (err) {
    console.error(`[code-session:${sessionId}] Failed to gather results:`, err);
  }
}

// ---------------------------------------------------------------------------
// code:start — Start a coding session in an isolated worktree
// ---------------------------------------------------------------------------

registerCardHandler("code:start", {
  label: "Start Session",
  successMessage: "Coding session started",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const task = data.task as string;
    const context = data.context as string | undefined;
    const branchName = data.branchName as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !task || !branchName) {
      return {
        status: "error",
        error: "Missing required fields: sessionId, task, or branchName",
      };
    }

    // Reserve the session slot atomically to prevent concurrent starts
    const placeholder = {
      pid: 0,
      kill: () => {},
      process: null as unknown,
      state: 'running' as const,
      sendMessage: () => {},
      closeInput: () => {},
    } as ActiveSession;
    setSession(sessionId, placeholder);

    let worktree: { path: string; branchName: string };
    try {
      worktree = createWorktree(branchName, sessionId);
    } catch (err) {
      removeSession(sessionId);
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to create worktree: ${msg}` };
    }

    // Track cumulative turns and cost across multi-turn conversation
    let totalTurns = 0;
    let totalCostUsd: number | null = null;

    let session: ActiveSession;
    try {
      const systemPrompt = buildCodePrompt(task, context);

      session = startSession({
        sessionId,
        systemPrompt,
        task,
        worktreePath: worktree.path,

        onProgress(event) {
          console.log(`[code-session:${sessionId}] ${event.type}`, event.text ?? event.tool ?? "");
        },

        async onResult(result) {
          // Accumulate turns and cost across turns
          totalTurns = result.turns;
          if (result.costUsd !== null) {
            totalCostUsd = result.costUsd;
          }

          // Update card data with latest state + last message
          if (cardId) {
            try {
              const currentCard = await getCard(cardId);
              if (currentCard?.status === "confirmed") {
                await updateCard(cardId, {
                  data: {
                    ...data,
                    worktreePath: worktree.path,
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

          // Update Telegram status message
          updateSessionTelegram(
            sessionId,
            formatSessionTelegram('waiting', task, totalTurns, totalCostUsd, {
              lastMessage: result.text,
            }),
            cardId ? getSessionKeyboard('waiting', cardId) : undefined,
          );
        },

        async onError(error) {
          removeSession(sessionId);

          try {
            cleanupWorktree(worktree.path, branchName);
          } catch {
            // ignore cleanup failures
          }

          if (cardId) {
            try {
              await updateCard(cardId, {
                status: "error",
                result: { error: error.message },
              });
            } catch (err) {
              console.error(`[code-session:${sessionId}] Failed to update card on error:`, err);
            }
          }

          // Update Telegram status message
          updateSessionTelegram(
            sessionId,
            formatSessionTelegram('error', task, 0, null, { error: error.message }),
          );
        },
      });
    } catch (err) {
      removeSession(sessionId);
      try { cleanupWorktree(worktree.path, branchName); } catch { /* best effort */ }
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to start session: ${msg}` };
    }

    // Replace placeholder with real session handle
    setSession(sessionId, session);

    // Listen for process exit to finalize the session
    session.process.on('exit', () => {
      if (session.state === 'completed' || session.state === 'waiting_for_input') {
        finalizeSession(sessionId, cardId, data, worktree.path, totalTurns, totalCostUsd);
      }
    });

    // Update card to running state
    if (cardId) {
      await updateCard(cardId, {
        data: {
          ...data,
          worktreePath: worktree.path,
          state: 'running',
          totalTurns: 0,
          totalCostUsd: null,
        },
      });
    }

    // Send initial Telegram status message
    updateSessionTelegram(
      sessionId,
      formatSessionTelegram('running', task, 0, null),
      cardId ? getSessionKeyboard('running', cardId) : undefined,
    );

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:respond — Send a user message to a running session
// ---------------------------------------------------------------------------

registerCardHandler("code:respond", {
  label: "Send Response",
  successMessage: "Message sent",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const message = data.message as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !message) {
      return { status: "error", error: "Missing sessionId or message" };
    }

    const session = getActiveSession(sessionId);
    if (!session) {
      return { status: "error", error: "No active session found" };
    }

    if (session.state !== 'waiting_for_input') {
      return { status: "error", error: `Session is ${session.state}, not waiting for input` };
    }

    // Send the message and update card state
    session.sendMessage(message);

    const task = (data.task as string) || 'Unknown task';
    const totalTurns = (data.totalTurns as number) || 0;
    const totalCostUsd = (data.totalCostUsd as number) ?? null;

    if (cardId) {
      try {
        await updateCard(cardId, {
          data: {
            ...data,
            state: 'running',
            lastMessage: undefined,
          },
        });
      } catch (err) {
        console.error(`[code-session:${sessionId}] Failed to update card:`, err);
      }
    }

    // Update Telegram status back to running
    updateSessionTelegram(
      sessionId,
      formatSessionTelegram('running', task, totalTurns, totalCostUsd),
      cardId ? getSessionKeyboard('running', cardId) : undefined,
    );

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:finish — Close stdin to let the session complete gracefully
// ---------------------------------------------------------------------------

registerCardHandler("code:finish", {
  label: "Finish Session",
  successMessage: "Session finishing...",

  async execute(data) {
    const sessionId = data.sessionId as string;

    if (!sessionId) {
      return { status: "error", error: "Missing sessionId" };
    }

    const session = getActiveSession(sessionId);
    if (!session) {
      return { status: "error", error: "No active session found" };
    }

    session.closeInput();
    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:approve — Merge worktree branch into main and clean up
// ---------------------------------------------------------------------------

registerCardHandler("code:approve", {
  label: "Approve & Merge",
  successMessage: "Changes merged to main!",
  confirmMessage: "Merge these changes into main?",

  async execute(data) {
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;
    const cardId = data._cardId as string | undefined;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    mergeWorktree(worktreePath, branchName);

    // Mark as terminal so it stops showing in pending lists
    if (cardId) {
      await updateCard(cardId, { data: { ...data, state: 'merged' } });
    }

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:reject — Discard worktree and branch
// ---------------------------------------------------------------------------

registerCardHandler("code:reject", {
  label: "Reject",
  successMessage: "Changes discarded",

  async execute(data) {
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;
    const cardId = data._cardId as string | undefined;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    // Best effort — don't fail if cleanup has issues
    try {
      cleanupWorktree(worktreePath, branchName);
    } catch {
      // ignore
    }

    // Mark as terminal so it stops showing in pending lists
    if (cardId) {
      await updateCard(cardId, { data: { ...data, state: 'rejected' } });
    }

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:stop — Kill a running session and clean up
// ---------------------------------------------------------------------------

registerCardHandler("code:stop", {
  label: "Stop Session",
  successMessage: "Session stopped",
  confirmMessage: "Stop the running coding session?",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId) {
      return { status: "error", error: "Missing sessionId" };
    }

    // Kill active session if it exists
    const session = getActiveSession(sessionId);
    if (session) {
      session.kill();
      removeSession(sessionId);
    }

    // Best-effort worktree cleanup
    if (worktreePath && branchName) {
      try {
        cleanupWorktree(worktreePath, branchName);
      } catch {
        // ignore
      }
    }

    // Mark as terminal so it stops showing in pending lists
    if (cardId) {
      await updateCard(cardId, { data: { ...data, state: 'stopped' } });
    }

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:resume — Restart a CLI session in an existing worktree
// ---------------------------------------------------------------------------

registerCardHandler("code:resume", {
  label: "Resume Session",
  successMessage: "Session resumed",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const task = data.task as string;
    const context = data.context as string | undefined;
    const branchName = data.branchName as string;
    const worktreePath = data.worktreePath as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !task || !worktreePath) {
      return { status: "error", error: "Missing required fields for resume" };
    }

    if (!worktreeExists(sessionId)) {
      return { status: "error", error: "Worktree no longer exists on disk" };
    }

    // Reserve session slot
    const placeholder = {
      pid: 0,
      kill: () => {},
      process: null as unknown,
      state: 'running' as const,
      sendMessage: () => {},
      closeInput: () => {},
    } as ActiveSession;
    setSession(sessionId, placeholder);

    let totalTurns = (data.totalTurns as number) || 0;
    let totalCostUsd = (data.totalCostUsd as number) ?? null;

    let session: ActiveSession;
    try {
      const resumeContext = [
        'RESUME: This session is being resumed from a previous run.',
        'The worktree already has work in progress.',
        'Check `git log --oneline main..HEAD` and `git status` to see what was done.',
        'Continue from where you left off.',
        context || '',
      ].filter(Boolean).join('\n');

      const systemPrompt = buildCodePrompt(task, resumeContext);

      session = startSession({
        sessionId,
        systemPrompt,
        task: `Continue working on: ${task}\n\nThis is a resumed session. Check git log and git status to see what was already done, then continue.`,
        worktreePath,

        onProgress(event) {
          console.log(`[code-session:${sessionId}] ${event.type}`, event.text ?? event.tool ?? "");
        },

        async onResult(result) {
          totalTurns = result.turns;
          if (result.costUsd !== null) totalCostUsd = result.costUsd;

          if (cardId) {
            try {
              const currentCard = await getCard(cardId);
              if (currentCard?.status === "confirmed") {
                await updateCard(cardId, {
                  data: {
                    ...data,
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

          updateSessionTelegram(
            sessionId,
            formatSessionTelegram('waiting', task, totalTurns, totalCostUsd, {
              lastMessage: result.text,
            }),
            cardId ? getSessionKeyboard('waiting', cardId) : undefined,
          );
        },

        async onError(error) {
          removeSession(sessionId);
          // DON'T clean up worktree — it may have partial work worth keeping

          if (cardId) {
            try {
              await updateCard(cardId, {
                data: { ...data, state: 'error' },
                result: { error: error.message },
              });
            } catch (err) {
              console.error(`[code-session:${sessionId}] Failed to update card on error:`, err);
            }
          }

          updateSessionTelegram(
            sessionId,
            formatSessionTelegram('error', task, totalTurns, totalCostUsd, { error: error.message }),
          );
        },
      });
    } catch (err) {
      removeSession(sessionId);
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to resume session: ${msg}` };
    }

    setSession(sessionId, session);

    session.process.on('exit', () => {
      if (session.state === 'completed' || session.state === 'waiting_for_input') {
        finalizeSession(sessionId, cardId, data, worktreePath, totalTurns, totalCostUsd);
      }
    });

    if (cardId) {
      await updateCard(cardId, {
        data: {
          ...data,
          worktreePath,
          state: 'running',
          totalTurns,
          totalCostUsd,
        },
      });
    }

    updateSessionTelegram(
      sessionId,
      formatSessionTelegram('running', task, totalTurns, totalCostUsd),
      cardId ? getSessionKeyboard('running', cardId) : undefined,
    );

    return { status: "confirmed" };
  },
});

