/**
 * Shared types for the code agent system.
 *
 * Used by: executor, session-manager, handlers, telegram, UI components.
 */

// ---------------------------------------------------------------------------
// Session states
// ---------------------------------------------------------------------------

/** Runtime state of the executor process. */
export type ExecutorState = 'running' | 'waiting_for_input' | 'completed' | 'error';

/** Stored state in the card's JSONB data field (includes terminal states). */
export type CodeSessionState =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'merged'
  | 'rejected'
  | 'stopped'
  | 'error';

/** UI display mode derived from card status + session state. */
export type SessionMode =
  | 'loading'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'error';

// ---------------------------------------------------------------------------
// Card data shape
// ---------------------------------------------------------------------------

/** Typed shape of `action_cards.data` for code-pattern cards. */
export interface CodeSessionData {
  sessionId: string;
  task: string;
  context?: string | null;
  branchName: string;
  worktreePath?: string;
  state?: CodeSessionState;
  lastMessage?: string;
  totalTurns?: number;
  totalCostUsd?: number | null;
  result?: CodeResult;
}

/** Result gathered from worktree after a session completes. */
export interface CodeResult {
  sessionId: string;
  turns: number;
  costUsd: number | null;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    summary: string;
  };
  changedFiles: string[];
  log: string;
}
