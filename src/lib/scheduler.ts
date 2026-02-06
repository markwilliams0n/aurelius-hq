/**
 * Background Task Scheduler
 *
 * Manages periodic background tasks like heartbeat and synthesis.
 * Uses node-cron for scheduling.
 */

import cron, { type ScheduledTask } from 'node-cron';

// Track if schedulers are already running (prevents duplicate starts on hot reload)
let heartbeatScheduled = false;
let heartbeatTask: ScheduledTask | null = null;

/**
 * Get heartbeat interval from environment or use default
 */
function getHeartbeatInterval(): number {
  const envInterval = process.env.HEARTBEAT_INTERVAL_MINUTES;
  if (envInterval) {
    const parsed = parseInt(envInterval, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 15; // Default: every 15 minutes
}

/**
 * Check if heartbeat scheduling is enabled
 */
function isHeartbeatEnabled(): boolean {
  const enabled = process.env.HEARTBEAT_ENABLED;
  // Enabled by default, only disable if explicitly set to 'false'
  return enabled !== 'false';
}

/**
 * Run heartbeat with error handling
 */
async function runHeartbeatSafe(): Promise<void> {
  const startTime = Date.now();
  console.log(`[Scheduler] Running scheduled heartbeat at ${new Date().toISOString()}`);

  try {
    // Dynamic import to avoid circular dependencies
    const { runHeartbeat } = await import('./memory/heartbeat');
    const { logActivity } = await import('./activity');

    const result = await runHeartbeat();

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Heartbeat completed in ${duration}ms`);

    // Log to database (visible on System page)
    await logActivity({
      eventType: 'heartbeat_run',
      actor: 'system',
      description: `Heartbeat: connector sync complete`,
      metadata: {
        trigger: 'scheduled',
        success: result.allStepsSucceeded,
        steps: result.steps,
        gmail: result.gmail,
        granola: result.granola,
        linear: result.linear,
        slack: result.slack,
        warnings: result.warnings,
        duration,
        error: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Scheduler] Heartbeat failed after ${duration}ms:`, error);

    try {
      const { logActivity } = await import('./activity');
      await logActivity({
        eventType: 'heartbeat_run',
        actor: 'system',
        description: `Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          trigger: 'scheduled',
          success: false,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (logError) {
      console.error('[Scheduler] Failed to log heartbeat failure:', logError);
    }
  }
}

/**
 * Calculate next run time for logging
 */
function getNextRunTime(intervalMinutes: number): Date {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setMinutes(Math.ceil(now.getMinutes() / intervalMinutes) * intervalMinutes);
  nextRun.setSeconds(0);
  nextRun.setMilliseconds(0);
  if (nextRun <= now) {
    nextRun.setMinutes(nextRun.getMinutes() + intervalMinutes);
  }
  return nextRun;
}

/**
 * Start the heartbeat scheduler
 *
 * Called from instrumentation.ts when the server starts.
 * Safe to call multiple times (will only schedule once).
 */
export function startHeartbeatScheduler(): void {
  // Prevent duplicate scheduling (important for hot reload in dev)
  if (heartbeatScheduled) {
    console.log('[Scheduler] Heartbeat already scheduled, skipping');
    return;
  }

  // Check if enabled
  if (!isHeartbeatEnabled()) {
    console.log('[Scheduler] Heartbeat scheduling disabled via HEARTBEAT_ENABLED=false');
    return;
  }

  const intervalMinutes = getHeartbeatInterval();

  // Create cron expression: "*/15 * * * *" means every 15 minutes
  const cronExpression = `*/${intervalMinutes} * * * *`;

  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  // Schedule the task
  heartbeatTask = cron.schedule(cronExpression, () => {
    // Run async without blocking
    runHeartbeatSafe().catch(err => {
      console.error('[Scheduler] Unhandled error in heartbeat:', err);
    });
  });

  heartbeatScheduled = true;

  const nextRun = getNextRunTime(intervalMinutes);
  console.log(`[Scheduler] Heartbeat scheduled: every ${intervalMinutes} minutes`);
  console.log(`[Scheduler] Next heartbeat at: ${nextRun.toISOString()}`);
}

/**
 * Stop the heartbeat scheduler
 *
 * Useful for testing or graceful shutdown.
 */
export function stopHeartbeatScheduler(): void {
  if (heartbeatTask) {
    heartbeatTask.stop();
    heartbeatTask = null;
    heartbeatScheduled = false;
    console.log('[Scheduler] Heartbeat scheduler stopped');
  }
}

/**
 * Check if heartbeat is currently scheduled
 */
export function isHeartbeatScheduled(): boolean {
  return heartbeatScheduled;
}

/**
 * Manually trigger a heartbeat (outside of schedule)
 *
 * Useful for testing or immediate processing needs.
 */
export async function triggerHeartbeat(): Promise<void> {
  console.log('[Scheduler] Manual heartbeat trigger');
  await runHeartbeatSafe();
}

/**
 * Start all schedulers
 */
export function startAllSchedulers(): void {
  startHeartbeatScheduler();
}

/**
 * Stop all schedulers
 */
export function stopAllSchedulers(): void {
  stopHeartbeatScheduler();
}
