/**
 * Heartbeat Orchestrator
 *
 * Composes focused jobs (connector sync, classification, daily maintenance)
 * into the full heartbeat pipeline. Preserves the original HeartbeatResult
 * shape so callers (scheduler, API route) don't need changes.
 *
 * Run order:
 * 1. Daily maintenance (backup + learning)
 * 2. Connector syncs (Granola, Gmail)
 * 3. Classification (AI email classifier)
 */

import type { GranolaSyncResult } from '@/lib/granola';
import type { GmailSyncResult } from '@/lib/gmail';
import type { BackupResult } from './backup';
import type { DailyLearningResult } from '@/lib/triage/daily-learning';
import { syncAllConnectors } from '@/lib/connectors/sync-all';
import { runDailyMaintenance } from '@/lib/jobs/daily-maintenance';
import { classifyNewEmails } from '@/lib/triage/classify-emails-pipeline';

// --- Public type exports (re-exported from connectors/types for backward compatibility) ---

export type { HeartbeatStep, HeartbeatStepStatus } from '@/lib/connectors/types';

import type { HeartbeatStep, HeartbeatStepStatus } from '@/lib/connectors/types';

export type ProgressCallback = (step: HeartbeatStep, status: HeartbeatStepStatus, detail?: string) => void;

export interface HeartbeatOptions {
  /** Skip daily backup (backup still runs once per day by default) */
  skipBackup?: boolean;
  /** Skip Granola sync */
  skipGranola?: boolean;
  /** Skip Gmail sync */
  skipGmail?: boolean;
  /** Skip classification pipeline */
  skipClassify?: boolean;
  /** Skip daily learning loop */
  skipLearning?: boolean;
  /** Progress callback for streaming status updates */
  onProgress?: ProgressCallback;
}

export interface StepResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface HeartbeatResult {
  granola?: GranolaSyncResult;
  gmail?: GmailSyncResult;
  backup?: BackupResult;
  learning?: DailyLearningResult;
  /** Granular step results for debugging */
  steps: {
    backup?: StepResult;
    granola?: StepResult;
    gmail?: StepResult;
    classify?: StepResult;
    learning?: StepResult;
  };
  /** Whether all steps succeeded */
  allStepsSucceeded: boolean;
  /** Warnings from partial failures */
  warnings: string[];
}

/**
 * Run the heartbeat process:
 * 1. Daily backup (once per day, keeps last 7)
 * 2. Sync Granola meetings
 * 3. Sync Gmail messages
 * 4. Classify new gmail items (AI email classifier)
 * 5. Daily learning loop (once per day -- analyze triage patterns, suggest rules)
 *
 * Memory extraction is handled by Supermemory -- content is sent to Supermemory
 * at the point of creation (chat messages, triage saves) rather than in heartbeat.
 *
 * Each step is isolated - failures in one step don't prevent others from running.
 */
export async function runHeartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResult> {
  console.log('[Heartbeat] Starting...');
  const overallStart = Date.now();

  const warnings: string[] = [];
  const steps: HeartbeatResult['steps'] = {};
  const progress = options.onProgress;

  // --- 1. Daily maintenance (backup + learning) ---
  const maintenance = await runDailyMaintenance({
    skipBackup: options.skipBackup,
    skipLearning: options.skipLearning,
    onProgress: progress as ((step: string, status: string, detail?: string) => void) | undefined,
  });

  if (maintenance.steps.backup) steps.backup = maintenance.steps.backup;
  if (maintenance.steps.learning) steps.learning = maintenance.steps.learning;
  warnings.push(...maintenance.warnings);

  // --- 2. Connector syncs ---
  const skipConnectors: string[] = [];
  if (options.skipGranola) skipConnectors.push('granola');
  if (options.skipGmail) skipConnectors.push('gmail');
  const sync = await syncAllConnectors({
    skip: skipConnectors,
    onProgress: progress,
  });

  // Map connector step results into the heartbeat steps shape
  for (const r of sync.results) {
    const key = r.connector as keyof typeof steps;
    steps[key] = {
      success: r.success,
      durationMs: r.durationMs,
      error: r.error,
    };
  }
  warnings.push(...sync.warnings);

  // --- 3. Classification ---
  if (!options.skipClassify) {
    progress?.('classify', 'start');
    const classifyStart = Date.now();
    try {
      const classifyResult = await classifyNewEmails();
      if (classifyResult.classified > 0) {
        console.log(
          `[Heartbeat] Classify: ${classifyResult.classified} emails (archive:${classifyResult.byTier.archive} review:${classifyResult.byTier.review} attention:${classifyResult.byTier.attention})`
        );
      }
      steps.classify = {
        success: true,
        durationMs: Date.now() - classifyStart,
      };
      progress?.('classify', 'done', classifyResult.classified > 0
        ? `${classifyResult.classified} emails`
        : undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Classification failed:', errMsg);
      warnings.push(`Classification failed: ${errMsg}`);
      progress?.('classify', 'error', errMsg);
      steps.classify = {
        success: false,
        durationMs: Date.now() - classifyStart,
        error: errMsg,
      };
    }
  }

  // --- Finalize ---
  const totalDuration = Date.now() - overallStart;
  const allStepsSucceeded = Object.values(steps).every(s => s?.success ?? true);

  console.log(
    `[Heartbeat] Complete in ${totalDuration}ms` +
    (warnings.length > 0 ? ` (${warnings.length} warnings)` : '')
  );

  return {
    granola: sync.connectorResults.granola as GranolaSyncResult | undefined,
    gmail: sync.connectorResults.gmail as GmailSyncResult | undefined,
    backup: maintenance.backup,
    learning: maintenance.learning,
    steps,
    allStepsSucceeded,
    warnings,
  };
}
