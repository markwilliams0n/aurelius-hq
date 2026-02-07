import { syncGranolaMeetings, type GranolaSyncResult } from '@/lib/granola';
import { syncGmailMessages, type GmailSyncResult } from '@/lib/gmail';
import { syncLinearNotifications, type LinearSyncResult } from '@/lib/linear';
import { syncSlackMessages, type SlackSyncResult, startSocketMode, isSocketConfigured } from '@/lib/slack';
import { syncSlackDirectory } from '@/lib/slack/directory';
import { createBackup, type BackupResult } from './backup';

export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'linear' | 'slack';
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
  /** Granular step results for debugging */
  steps: {
    backup?: StepResult;
    granola?: StepResult;
    gmail?: StepResult;
    linear?: StepResult;
    slack?: StepResult;
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
 *
 * Memory extraction is handled by Supermemory — content is sent to Supermemory
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

  // Step 1: Daily backup (runs once per day, keeps last 7)
  let backupResult: BackupResult | undefined;
  if (!options.skipBackup) {
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

  // Step 2: Sync Granola meetings to triage
  let granolaResult: GranolaSyncResult | undefined;
  if (!options.skipGranola) {
    progress?.('granola', 'start');
    const granolaStart = Date.now();
    try {
      granolaResult = await syncGranolaMeetings();
      if (granolaResult.synced > 0) {
        console.log(`[Heartbeat] Granola: synced ${granolaResult.synced} meetings`);
      }
      steps.granola = {
        success: true,
        durationMs: Date.now() - granolaStart,
      };
      progress?.('granola', 'done', granolaResult.synced > 0 ? `${granolaResult.synced} meetings` : undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Granola sync failed:', errMsg);
      warnings.push(`Granola sync failed: ${errMsg}`);
      progress?.('granola', 'error', errMsg);
      steps.granola = {
        success: false,
        durationMs: Date.now() - granolaStart,
        error: errMsg,
      };
    }
  }

  // Step 3: Sync Gmail messages to triage
  let gmailResult: GmailSyncResult | undefined;
  if (!options.skipGmail) {
    progress?.('gmail', 'start');
    const gmailStart = Date.now();
    try {
      gmailResult = await syncGmailMessages();
      if (gmailResult.synced > 0) {
        console.log(`[Heartbeat] Gmail: synced ${gmailResult.synced} emails`);
      }
      steps.gmail = {
        success: true,
        durationMs: Date.now() - gmailStart,
      };
      const gmailDetail = [
        gmailResult.synced > 0 ? `${gmailResult.synced} synced` : null,
        gmailResult.archived > 0 ? `${gmailResult.archived} archived` : null,
      ].filter(Boolean).join(', ');
      progress?.('gmail', 'done', gmailDetail || undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Gmail sync failed:', errMsg);
      warnings.push(`Gmail sync failed: ${errMsg}`);
      progress?.('gmail', 'error', errMsg);
      steps.gmail = {
        success: false,
        durationMs: Date.now() - gmailStart,
        error: errMsg,
      };
    }
  }

  // Step 4: Sync Linear notifications to triage
  let linearResult: LinearSyncResult | undefined;
  if (!options.skipLinear) {
    progress?.('linear', 'start');
    const linearStart = Date.now();
    try {
      linearResult = await syncLinearNotifications();
      if (linearResult.synced > 0) {
        console.log(`[Heartbeat] Linear: synced ${linearResult.synced} notifications`);
      }
      steps.linear = {
        success: !linearResult.error,
        durationMs: Date.now() - linearStart,
        error: linearResult.error,
      };
      progress?.('linear', linearResult.error ? 'error' : 'done', linearResult.synced > 0 ? `${linearResult.synced} notifications` : undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Linear sync failed:', errMsg);
      warnings.push(`Linear sync failed: ${errMsg}`);
      progress?.('linear', 'error', errMsg);
      steps.linear = {
        success: false,
        durationMs: Date.now() - linearStart,
        error: errMsg,
      };
    }
  }

  // Step 5: Ensure Slack Socket Mode is connected
  let slackResult: SlackSyncResult | undefined;
  if (!options.skipSlack) {
    progress?.('slack', 'start');
    const slackStart = Date.now();
    try {
      if (isSocketConfigured()) {
        await startSocketMode();
        console.log('[Heartbeat] Slack Socket Mode connected');
        // Refresh workspace directory cache (skips if <24h old)
        try {
          await syncSlackDirectory();
        } catch (dirErr) {
          console.warn('[Heartbeat] Slack directory sync failed:', dirErr);
        }
        steps.slack = {
          success: true,
          durationMs: Date.now() - slackStart,
        };
        progress?.('slack', 'done', 'Socket Mode connected');
      } else {
        slackResult = await syncSlackMessages();
        if (slackResult.synced > 0) {
          console.log(`[Heartbeat] Slack: synced ${slackResult.synced} messages`);
        }
        steps.slack = {
          success: !slackResult.error,
          durationMs: Date.now() - slackStart,
          error: slackResult.error,
        };
        progress?.('slack', slackResult.error ? 'error' : 'done', slackResult.synced > 0 ? `${slackResult.synced} messages` : undefined);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Slack setup failed:', errMsg);
      warnings.push(`Slack setup failed: ${errMsg}`);
      progress?.('slack', 'error', errMsg);
      steps.slack = {
        success: false,
        durationMs: Date.now() - slackStart,
        error: errMsg,
      };
    }
  }

  const totalDuration = Date.now() - overallStart;
  const allStepsSucceeded = Object.values(steps).every(s => s?.success ?? true);

  console.log(
    `[Heartbeat] Complete in ${totalDuration}ms` +
    (warnings.length > 0 ? ` (${warnings.length} warnings)` : '')
  );

  return {
    granola: granolaResult,
    gmail: gmailResult,
    linear: linearResult,
    slack: slackResult,
    backup: backupResult,
    steps,
    allStepsSucceeded,
    warnings,
  };
}
