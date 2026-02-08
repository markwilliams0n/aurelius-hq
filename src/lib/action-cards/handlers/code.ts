import { registerCardHandler } from "../registry";
import {
  createWorktree,
  cleanupWorktree,
  mergeWorktree,
  getWorktreeStats,
  getChangedFiles,
  getWorktreeLog,
} from "@/lib/capabilities/code/worktree";
import { startSession, type ActiveSession } from "@/lib/capabilities/code/executor";
import { buildCodePrompt } from "@/lib/capabilities/code/prompts";
import { getCard, updateCard } from "../db";

// ---------------------------------------------------------------------------
// Active session tracking
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, ActiveSession>();

function hasActiveSession(): boolean {
  return activeSessions.size > 0;
}

export function getActiveSessions(): Map<string, ActiveSession> {
  return activeSessions;
}

// Kill all active sessions on server shutdown to prevent orphaned processes
process.on('SIGTERM', () => {
  for (const [id, session] of activeSessions) {
    console.log(`[code-session] Killing session ${id} on SIGTERM`);
    session.kill();
  }
  activeSessions.clear();
});

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
  activeSessions.delete(sessionId);

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
    if (hasActiveSession()) {
      return {
        status: "error",
        error: "A coding session is already running. Stop it before starting a new one.",
      };
    }

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
    activeSessions.set(sessionId, placeholder);

    let worktree: { path: string; branchName: string };
    try {
      worktree = createWorktree(branchName, sessionId);
    } catch (err) {
      activeSessions.delete(sessionId);
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
        },

        async onError(error) {
          activeSessions.delete(sessionId);

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
        },
      });
    } catch (err) {
      activeSessions.delete(sessionId);
      try { cleanupWorktree(worktree.path, branchName); } catch { /* best effort */ }
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to start session: ${msg}` };
    }

    // Replace placeholder with real session handle
    activeSessions.set(sessionId, session);

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

    const session = activeSessions.get(sessionId);
    if (!session) {
      return { status: "error", error: "No active session found" };
    }

    if (session.state !== 'waiting_for_input') {
      return { status: "error", error: `Session is ${session.state}, not waiting for input` };
    }

    // Send the message and update card state
    session.sendMessage(message);

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

    const session = activeSessions.get(sessionId);
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

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    mergeWorktree(worktreePath, branchName);
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

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    // Best effort — don't fail if cleanup has issues
    try {
      cleanupWorktree(worktreePath, branchName);
    } catch {
      // ignore
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

    if (!sessionId) {
      return { status: "error", error: "Missing sessionId" };
    }

    // Kill active session if it exists
    const session = activeSessions.get(sessionId);
    if (session) {
      session.kill();
      activeSessions.delete(sessionId);
    }

    // Best-effort worktree cleanup
    if (worktreePath && branchName) {
      try {
        cleanupWorktree(worktreePath, branchName);
      } catch {
        // ignore
      }
    }

    return { status: "confirmed" };
  },
});
