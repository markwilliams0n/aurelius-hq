/**
 * Shared types for the code agent system.
 *
 * Used by: executor, session-manager, handlers, telegram, UI components.
 */

// ---------------------------------------------------------------------------
// Session states
// ---------------------------------------------------------------------------

/** Stored state in the card's JSONB data field (includes terminal states). */
export type CodeSessionState =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'merged'
  | 'rejected'
  | 'stopped'
  | 'error'
  // Autonomous flow states
  | 'planning'
  | 'plan-ready'
  | 'executing'
  | 'pushing'
  | 'reviewing'
  | 'fixing';

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
  /** Autonomous flow fields */
  autonomous?: boolean;
  plan?: string;
  planApprovedAt?: string;
  prUrl?: string;
  autoApproveAt?: string;
  reviewRound?: number;
  reviewIssues?: string;
}

/** Configuration for autonomous code agent (stored in capability:code-agent config). */
export interface CodeAgentConfig {
  planning: {
    autoApproveMinutes: number;
    maxPlanningCostUsd: number;
  };
  execution: {
    maxCostUsd: number;
    maxDurationMinutes: number;
    maxRetries: number;
    commitStrategy: 'incremental' | 'single';
  };
  review: {
    maxRounds: number;
  };
  triggers: {
    heartbeatEnabled: boolean;
    linearLabel: string;
    maxConcurrentSessions: number;
    pauseIfOpenPR: boolean;
  };
  notifications: {
    onPlanReady: boolean;
    onProgressMilestones: boolean;
    onComplete: boolean;
    onError: boolean;
  };
}

export const DEFAULT_CODE_AGENT_CONFIG: CodeAgentConfig = {
  planning: {
    autoApproveMinutes: 20,
    maxPlanningCostUsd: 5,
  },
  execution: {
    maxCostUsd: 20,
    maxDurationMinutes: 120,
    maxRetries: 3,
    commitStrategy: 'incremental',
  },
  review: {
    maxRounds: 3,
  },
  triggers: {
    heartbeatEnabled: false,
    linearLabel: 'aurelius',
    maxConcurrentSessions: 1,
    pauseIfOpenPR: true,
  },
  notifications: {
    onPlanReady: true,
    onProgressMilestones: true,
    onComplete: true,
    onError: true,
  },
};

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
