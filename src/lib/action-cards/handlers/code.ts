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
import { updateCard } from "../db";

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
    const maxTurns = (data.maxTurns as number) ?? 25;
    const timeoutMs = (data.timeoutMs as number) ?? 300_000;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !task || !branchName) {
      return {
        status: "error",
        error: "Missing required fields: sessionId, task, or branchName",
      };
    }

    // Create isolated worktree
    const worktree = createWorktree(branchName, sessionId);

    // Build the prompt
    const prompt = buildCodePrompt(task, context);

    // Start the session (non-blocking — runs in background)
    const session = startSession({
      sessionId,
      prompt,
      worktreePath: worktree.path,
      maxTurns,
      timeoutMs,

      onProgress(event) {
        // v1: log to console
        console.log(`[code-session:${sessionId}] ${event.type}`, event.text ?? event.tool ?? "");
      },

      async onComplete(result) {
        activeSessions.delete(sessionId);

        // Gather diff stats, changed files, and log from the worktree
        try {
          const stats = getWorktreeStats(worktree.path);
          const changedFiles = getChangedFiles(worktree.path);
          const log = getWorktreeLog(worktree.path);

          if (cardId) {
            await updateCard(cardId, {
              status: "confirmed",
              data: {
                ...data,
                worktreePath: worktree.path,
                result: {
                  sessionId: result.sessionId,
                  turns: result.turns,
                  durationMs: result.durationMs,
                  costUsd: result.costUsd,
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
      },

      async onError(error) {
        activeSessions.delete(sessionId);

        // Best-effort cleanup
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

    activeSessions.set(sessionId, session);

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
