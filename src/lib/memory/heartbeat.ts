/**
 * Heartbeat Orchestrator
 *
 * Composes focused jobs (connector sync, classification, daily maintenance)
 * into the full heartbeat pipeline. Preserves the original HeartbeatResult
 * shape so callers (scheduler, API route) don't need changes.
 *
 * Run order:
 * 1. Daily maintenance (backup + learning)
 * 2. Connector syncs (Granola, Gmail, Linear, Slack)
 * 3. Classification (rule -> Ollama -> Kimi)
 */

import type { GranolaSyncResult } from '@/lib/granola';
import type { GmailSyncResult } from '@/lib/gmail';
import type { LinearSyncResult } from '@/lib/linear';
import type { SlackSyncResult } from '@/lib/slack';
import type { BackupResult } from './backup';
import type { DailyLearningResult } from '@/lib/triage/daily-learning';
import { syncAllConnectors } from '@/lib/connectors/sync-all';
import { runDailyMaintenance } from '@/lib/jobs/daily-maintenance';
import { classifyNewItems } from '@/lib/triage/classify';
import { seedDefaultRules } from '@/lib/triage/rules';

// --- Public type exports (preserved for callers) ---

export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'linear' | 'slack' | 'classify' | 'learning';
export type HeartbeatStepStatus = 'start' | 'done' | 'skip' | 'error';
export type ProgressCallback = (step: HeartbeatStep, status: HeartbeatStepStatus, detail?: string) => void;

export interface HeartbeatOptions {
  /** Skip daily backup (backup still runs once per day by default) */
  skipBackup?: boolean;
  /** Skip Granola sync */
  skipGranola?: boolean;
  /** Skip Gmail sync */
  skipGmail?: boolean;
  /** Skip Linear sync */
  skipLinear?: boolean;
  /** Skip Slack sync */
  skipSlack?: boolean;
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
  linear?: LinearSyncResult;
  slack?: SlackSyncResult;
  backup?: BackupResult;
  learning?: DailyLearningResult;
  /** Granular step results for debugging */
  steps: {
    backup?: StepResult;
    granola?: StepResult;
    gmail?: StepResult;
    linear?: StepResult;
    slack?: StepResult;
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
 * 4. Sync Linear notifications
 * 5. Sync Slack messages
 * 6. Classify new inbox items (rule -> Ollama -> Kimi)
 * 7. Daily learning loop (once per day -- analyze triage patterns, suggest rules)
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
  if (options.skipLinear) skipConnectors.push('linear');
  if (options.skipSlack) skipConnectors.push('slack');

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
      // Ensure seed rules exist before classifying
      await seedDefaultRules();
      const classifyResult = await classifyNewItems();
      if (classifyResult.classified > 0) {
        console.log(
          `[Heartbeat] Classify: ${classifyResult.classified} items (rule:${classifyResult.byTier.rule} ollama:${classifyResult.byTier.ollama} kimi:${classifyResult.byTier.kimi})`
        );
      }
      steps.classify = {
        success: true,
        durationMs: Date.now() - classifyStart,
      };
      progress?.('classify', 'done', classifyResult.classified > 0
        ? `${classifyResult.classified} items`
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
    granola: sync.connectorResults.granola,
    gmail: sync.connectorResults.gmail,
    linear: sync.connectorResults.linear,
    slack: sync.connectorResults.slack,
    backup: maintenance.backup,
    learning: maintenance.learning,
    steps,
    allStepsSucceeded,
    warnings,
  };
}
