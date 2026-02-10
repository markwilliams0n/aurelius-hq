/**
 * Connector Sync Orchestration
 *
 * Runs all connector syncs (Granola, Gmail, Linear, Slack) sequentially,
 * each wrapped in its own try/catch so one failure doesn't block others.
 *
 * Extracted from heartbeat.ts — preserves all original behavior including
 * logging, error handling, and the Slack Socket Mode / polling fallback.
 */

import { syncGranolaMeetings, type GranolaSyncResult } from '@/lib/granola';
import { syncGmailMessages, type GmailSyncResult } from '@/lib/gmail';
import { syncLinearNotifications, type LinearSyncResult } from '@/lib/linear';
import { syncSlackMessages, type SlackSyncResult, startSocketMode, isSocketConfigured } from '@/lib/slack';
import { syncSlackDirectory } from '@/lib/slack/directory';
import { logConnectorSync } from '@/lib/system-events';
import type { ConnectorSyncResult } from './types';

export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'linear' | 'slack' | 'classify' | 'learning';
export type HeartbeatStepStatus = 'start' | 'done' | 'skip' | 'error';

export interface ConnectorSyncOptions {
  /** Connector names to skip */
  skip?: string[];
  /** Progress callback (same signature as heartbeat uses) */
  onProgress?: (step: HeartbeatStep, status: HeartbeatStepStatus, detail?: string) => void;
}

/** Per-connector raw results (typed to the original connector result types) */
export interface ConnectorResults {
  granola?: GranolaSyncResult;
  gmail?: GmailSyncResult;
  linear?: LinearSyncResult;
  slack?: SlackSyncResult;
}

/** Full return value from syncAllConnectors */
export interface SyncAllResult {
  results: ConnectorSyncResult[];
  connectorResults: ConnectorResults;
  warnings: string[];
}

interface ConnectorDef {
  name: string;
  step: HeartbeatStep;
  run: () => Promise<{
    result: unknown;
    synced: number;
    success: boolean;
    error?: string;
    detail?: string;
    logCount?: number;
  }>;
}

/**
 * Sync all connectors sequentially. Each connector is wrapped in its own
 * try/catch so a failure in one doesn't block the others.
 */
export async function syncAllConnectors(options: ConnectorSyncOptions = {}): Promise<SyncAllResult> {
  const skip = new Set(options.skip ?? []);
  const progress = options.onProgress;
  const results: ConnectorSyncResult[] = [];
  const warnings: string[] = [];
  const connectorResults: ConnectorResults = {};

  const connectors: ConnectorDef[] = [
    {
      name: 'granola',
      step: 'granola',
      run: async () => {
        const r = await syncGranolaMeetings();
        return {
          result: r,
          synced: r.synced,
          success: true,
          detail: r.synced > 0 ? `${r.synced} meetings` : undefined,
          logCount: r.synced,
        };
      },
    },
    {
      name: 'gmail',
      step: 'gmail',
      run: async () => {
        const r = await syncGmailMessages();
        const detail = [
          r.synced > 0 ? `${r.synced} synced` : null,
          r.archived > 0 ? `${r.archived} archived` : null,
        ].filter(Boolean).join(', ');
        return {
          result: r,
          synced: r.synced,
          success: true,
          detail: detail || undefined,
          logCount: r.synced,
        };
      },
    },
    {
      name: 'linear',
      step: 'linear',
      run: async () => {
        const r = await syncLinearNotifications();
        return {
          result: r,
          synced: r.synced,
          success: !r.error,
          error: r.error,
          detail: r.synced > 0 ? `${r.synced} notifications` : undefined,
          logCount: r.synced,
        };
      },
    },
    {
      name: 'slack',
      step: 'slack',
      run: async () => {
        if (isSocketConfigured()) {
          await startSocketMode();
          console.log('[Heartbeat] Slack Socket Mode connected');
          // Refresh workspace directory cache (skips if <24h old)
          try {
            await syncSlackDirectory();
          } catch (dirErr) {
            console.warn('[Heartbeat] Slack directory sync failed:', dirErr);
          }
          return {
            result: undefined,
            synced: 0,
            success: true,
            detail: 'Socket Mode connected',
          };
        } else {
          const r = await syncSlackMessages();
          return {
            result: r,
            synced: r.synced,
            success: !r.error,
            error: r.error,
            detail: r.synced > 0 ? `${r.synced} messages` : undefined,
            logCount: r.synced,
          };
        }
      },
    },
  ];

  for (const connector of connectors) {
    if (skip.has(connector.name)) {
      continue;
    }

    progress?.(connector.step, 'start');
    const start = Date.now();

    try {
      const outcome = await connector.run();
      const durationMs = Date.now() - start;

      // Store typed result
      if (outcome.result !== undefined) {
        (connectorResults as Record<string, unknown>)[connector.name] = outcome.result;
      }

      // Log successful syncs with items
      if (outcome.logCount && outcome.logCount > 0) {
        console.log(`[Heartbeat] ${capitalize(connector.name)}: synced ${outcome.logCount} ${connectorLabel(connector.name)}`);
        logConnectorSync(connector.name, outcome.logCount);
      }

      results.push({
        connector: connector.name,
        success: outcome.success,
        durationMs,
        error: outcome.error,
      });

      progress?.(connector.step, outcome.error ? 'error' : 'done', outcome.detail);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - start;
      console.error(`[Heartbeat] ${capitalize(connector.name)} sync failed:`, errMsg);
      warnings.push(`${capitalize(connector.name)} sync failed: ${errMsg}`);
      progress?.(connector.step, 'error', errMsg);

      results.push({
        connector: connector.name,
        success: false,
        durationMs,
        error: errMsg,
      });
    }
  }

  return { results, connectorResults, warnings };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function connectorLabel(name: string): string {
  switch (name) {
    case 'granola': return 'meetings';
    case 'gmail': return 'emails';
    case 'linear': return 'notifications';
    case 'slack': return 'messages';
    default: return 'items';
  }
}
