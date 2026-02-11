import { registerCardHandler } from "../registry";
import {
  createWorktree,
  cleanupWorktree,
  mergeWorktree,
  worktreeExists,
} from "@/lib/code/worktree";
import { updateCard } from "../db";
import {
  getSession as getActiveSession,
  removeSession,
  clearAutoApproveTimer,
} from "@/lib/code/session-manager";
import { notifySessionState } from "@/lib/code/telegram";
import { spawnSession, executePlan } from "@/lib/code/lifecycle";
import { spawnSync } from "child_process";

// Re-export for consumers that import from this file
export { getActiveSessions, finalizeZombieSession, getSessionForTelegramMessage, setTelegramMessage } from "@/lib/code/session-manager";
export { getSessionKeyboard, formatSessionTelegram } from "@/lib/code/telegram";

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

    let worktree: { path: string; branchName: string };
    try {
      worktree = createWorktree(branchName, sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to create worktree: ${msg}` };
    }

    return spawnSession({
      sessionId,
      task,
      context,
      branchName,
      worktreePath: worktree.path,
      cardId,
      cardData: data,
      cleanupOnError: () => {
        try { cleanupWorktree(worktree.path, branchName); } catch { /* best effort */ }
      },
    });
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

    notifySessionState(sessionId, 'running', cardId, task, totalTurns, totalCostUsd);

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
    const isAutonomous = data.autonomous === true;
    const prUrl = data.prUrl as string | undefined;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    if (isAutonomous && prUrl) {
      // Autonomous sessions have a GitHub PR — merge it via gh CLI
      const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
      if (!prNumber) {
        return { status: "error", error: `Could not extract PR number from: ${prUrl}` };
      }

      // Check PR state first — it may already be merged
      const stateCheck = spawnSync("gh", ["pr", "view", prNumber, "--json", "state", "-q", ".state"], {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 15000,
      });
      const prState = stateCheck.stdout?.toString().trim();

      if (prState !== "MERGED") {
        const result = spawnSync("gh", ["pr", "merge", prNumber, "--merge", "--delete-branch"], {
          cwd: process.cwd(),
          stdio: "pipe",
          timeout: 30000,
        });

        if (result.status !== 0) {
          const stderr = result.stderr?.toString().trim() || "Unknown error";
          return { status: "error", error: `Failed to merge PR #${prNumber}: ${stderr}` };
        }
      }

      // Pull the merged changes into local main
      spawnSync("git", ["pull", "origin", "main"], {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 15000,
      });

      // Clean up worktree (branch already deleted by --delete-branch)
      try { cleanupWorktree(worktreePath, branchName); } catch { /* best effort */ }
    } else {
      // Interactive sessions — local fast-forward merge
      mergeWorktree(worktreePath, branchName);
    }

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
    const isAutonomous = data.autonomous === true;
    const prUrl = data.prUrl as string | undefined;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktreePath or branchName" };
    }

    // Close the GitHub PR if autonomous
    if (isAutonomous && prUrl) {
      const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
      if (prNumber) {
        spawnSync("gh", ["pr", "close", prNumber, "--delete-branch"], {
          cwd: process.cwd(),
          stdio: "pipe",
          timeout: 15000,
        });
      }
    }

    // Best effort worktree cleanup
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
// code:approve-plan — Approve an autonomous plan and start execution
// ---------------------------------------------------------------------------

registerCardHandler("code:approve-plan", {
  label: "Approve Plan",
  successMessage: "Plan approved — execution starting",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !cardId) {
      return { status: "error", error: "Missing sessionId or cardId" };
    }

    // Clear auto-approve timer since user approved manually
    clearAutoApproveTimer(sessionId);

    try {
      await executePlan(sessionId, cardId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to start execution: ${msg}` };
    }

    return { status: "confirmed" };
  },
});

// ---------------------------------------------------------------------------
// code:edit-plan — Amend plan with user feedback, reset timer
// ---------------------------------------------------------------------------

registerCardHandler("code:edit-plan", {
  label: "Edit Plan",
  successMessage: "Plan updated — reply with your edits",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !cardId) {
      return { status: "error", error: "Missing sessionId or cardId" };
    }

    // Clear auto-approve timer — user is editing, will re-trigger on re-approval
    clearAutoApproveTimer(sessionId);

    // Update card state to indicate editing
    if (cardId) {
      await updateCard(cardId, {
        data: { ...data, state: 'plan-ready', autoApproveAt: null },
      });
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

    if (!sessionId || !task || !worktreePath) {
      return { status: "error", error: "Missing required fields for resume" };
    }

    if (!worktreeExists(sessionId)) {
      return { status: "error", error: "Worktree no longer exists on disk" };
    }

    return spawnSession({
      sessionId,
      task,
      context,
      branchName,
      worktreePath,
      cardId: data._cardId as string | undefined,
      cardData: data,
      isResume: true,
      initialTurns: (data.totalTurns as number) || 0,
      initialCost: (data.totalCostUsd as number) ?? null,
      keepWorktreeOnError: true,
    });
  },
});
