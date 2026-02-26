/**
 * Connector Types
 *
 * Shared type definitions for the connector system.
 * HeartbeatStep/HeartbeatStepStatus live here as the single source of truth —
 * heartbeat.ts and sync-all.ts re-export from here.
 */

// --- Heartbeat step types (single source of truth) ---

export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'classify' | 'learning';
export type HeartbeatStepStatus = 'start' | 'done' | 'skip' | 'error';

// --- Sync result types ---

export interface SyncResult {
  synced: number;
  errors: number;
  skipped: number;
  error?: string;
}

export interface ConnectorSyncResult {
  connector: string;
  result?: SyncResult;
  success: boolean;
  durationMs: number;
  error?: string;
}

// --- Connector interface ---

export interface Connector {
  name: string;
  /** The heartbeat step name this connector maps to */
  step: HeartbeatStep;
  /** Run the sync — fetch new items from source, insert into inbox */
  sync(): Promise<{
    normalized: SyncResult;
    raw: unknown;
    /** Human-readable detail for progress reporting */
    detail?: string;
    /** Number of items to log (may differ from synced count) */
    logCount?: number;
    /** Label for logged items (e.g. "meetings", "emails") */
    logLabel?: string;
  }>;
}
