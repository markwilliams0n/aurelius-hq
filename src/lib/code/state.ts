/**
 * Shared state derivation for the code agent system.
 *
 * Eliminates duplicated mode-detection logic across:
 * - code-session-detail.tsx (getMode)
 * - code-sessions-client.tsx (classifyCard)
 * - code-card.tsx (inline status checks)
 */

import type { SessionMode, CodeSessionData } from './types';

// ---------------------------------------------------------------------------
// Session mode derivation
// ---------------------------------------------------------------------------

/**
 * Derive the display mode from a card's status and data fields.
 *
 * This is the single source of truth for "what state is this session in?"
 * used by both backend and frontend code.
 */
export function deriveSessionMode(
  cardStatus: string,
  data: CodeSessionData,
): SessionMode {
  if (cardStatus === 'error' || cardStatus === 'dismissed') return 'error';

  if (cardStatus === 'confirmed') {
    if (data.state === 'waiting') return 'waiting';
    if (data.state === 'completed') return 'completed';
    if (data.state === 'running') return 'running';
    // Fallback: result exists without explicit state → completed
    return data.result ? 'completed' : 'running';
  }

  return 'pending';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format milliseconds as a human-readable duration. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

/** Format a timestamp as relative time (e.g. "5m ago", "2h ago"). */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
