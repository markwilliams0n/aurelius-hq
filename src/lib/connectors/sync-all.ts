/**
 * Connector Sync Orchestration
 *
 * Runs all registered connectors sequentially, each wrapped in its own
 * try/catch so one failure doesn't block others.
 *
 * Connector-specific logic (Socket Mode, directory sync, etc.) lives
 * in each adapter — this file is connector-agnostic.
 */

import { connectors } from './index';
import { logConnectorSync } from '@/lib/system-events';
import type { ConnectorSyncResult, HeartbeatStep, HeartbeatStepStatus } from './types';

// Re-export shared types so existing importers don't break
export type { HeartbeatStep, HeartbeatStepStatus } from './types';

export interface ConnectorSyncOptions {
  /** Connector names to skip */
  skip?: string[];
  /** Progress callback (same signature as heartbeat uses) */
  onProgress?: (step: HeartbeatStep, status: HeartbeatStepStatus, detail?: string) => void;
}

/** Per-connector raw results keyed by connector name */
export interface ConnectorResults {
  [key: string]: unknown;
}

/** Full return value from syncAllConnectors */
export interface SyncAllResult {
  results: ConnectorSyncResult[];
  connectorResults: ConnectorResults;
  warnings: string[];
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

  for (const connector of connectors) {
    if (skip.has(connector.name)) {
      continue;
    }

    progress?.(connector.step, 'start');
    const start = Date.now();

    try {
      const outcome = await connector.sync();
      const durationMs = Date.now() - start;

      // Store raw result for typed access by heartbeat
      if (outcome.raw !== undefined) {
        connectorResults[connector.name] = outcome.raw;
      }

      // Log successful syncs with items
      if (outcome.logCount && outcome.logCount > 0) {
        const label = outcome.logLabel ?? 'items';
        console.log(`[Heartbeat] ${capitalize(connector.name)}: synced ${outcome.logCount} ${label}`);
        logConnectorSync(connector.name, outcome.logCount);
      }

      results.push({
        connector: connector.name,
        success: !outcome.normalized.error,
        durationMs,
        error: outcome.normalized.error,
      });

      progress?.(connector.step, outcome.normalized.error ? 'error' : 'done', outcome.detail);
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
