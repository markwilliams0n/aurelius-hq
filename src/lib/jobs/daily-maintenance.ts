/**
 * Daily Maintenance Jobs
 *
 * Handles backup and daily learning — tasks that run once per day
 * (or are skipped if they already ran today).
 *
 * Extracted from heartbeat.ts — preserves all original behavior.
 */

import { createBackup, type BackupResult } from '@/lib/memory/backup';
import { runDailyLearning, type DailyLearningResult } from '@/lib/triage/daily-learning';

export interface MaintenanceResult {
  backup?: BackupResult;
  learning?: DailyLearningResult;
  steps: {
    backup?: { success: boolean; durationMs: number; error?: string };
    learning?: { success: boolean; durationMs: number; error?: string };
  };
  warnings: string[];
}

// Track when daily learning last ran (module-level, resets on server restart)
let lastLearningRunDate: string | null = null;

function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function runDailyMaintenance(options?: {
  skipBackup?: boolean;
  skipLearning?: boolean;
  onProgress?: (step: string, status: string, detail?: string) => void;
}): Promise<MaintenanceResult> {
  const steps: MaintenanceResult['steps'] = {};
  const warnings: string[] = [];
  const progress = options?.onProgress;

  // --- Backup ---
  let backupResult: BackupResult | undefined;
  if (!options?.skipBackup) {
    progress?.('backup', 'start');
    const backupStart = Date.now();
    try {
      backupResult = await createBackup();
      if (backupResult.skipped) {
        console.log(`[Heartbeat] Backup skipped (${backupResult.reason})`);
        progress?.('backup', 'skip', backupResult.reason);
      } else if (backupResult.success) {
        console.log(`[Heartbeat] Backup created: ${backupResult.backupPath}`);
        progress?.('backup', 'done');
      }
      steps.backup = {
        success: backupResult.success,
        durationMs: Date.now() - backupStart,
        error: backupResult.error,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Backup failed:', errMsg);
      warnings.push(`Backup failed: ${errMsg}`);
      progress?.('backup', 'error', errMsg);
      steps.backup = {
        success: false,
        durationMs: Date.now() - backupStart,
        error: errMsg,
      };
    }
  }

  // --- Daily Learning ---
  let learningResult: DailyLearningResult | undefined;
  if (!options?.skipLearning) {
    const today = getTodayDateString();
    if (lastLearningRunDate === today) {
      progress?.('learning', 'skip', 'Already ran today');
      console.log('[Heartbeat] Learning skipped (already ran today)');
      steps.learning = { success: true, durationMs: 0 };
    } else {
      progress?.('learning', 'start');
      const learningStart = Date.now();
      try {
        learningResult = await runDailyLearning();
        lastLearningRunDate = today;
        if (learningResult.suggestions > 0) {
          console.log(
            `[Heartbeat] Learning: ${learningResult.suggestions} suggestion(s), card: ${learningResult.cardId}`
          );
        } else {
          console.log('[Heartbeat] Learning: no patterns found');
        }
        steps.learning = {
          success: true,
          durationMs: Date.now() - learningStart,
        };
        progress?.('learning', 'done', learningResult.suggestions > 0
          ? `${learningResult.suggestions} suggestion(s)`
          : undefined);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[Heartbeat] Learning failed:', errMsg);
        warnings.push(`Learning failed: ${errMsg}`);
        progress?.('learning', 'error', errMsg);
        steps.learning = {
          success: false,
          durationMs: Date.now() - learningStart,
          error: errMsg,
        };
      }
    }
  }

  return {
    backup: backupResult,
    learning: learningResult,
    steps,
    warnings,
  };
}
