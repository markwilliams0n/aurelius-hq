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
let synthesisScheduled = false;
let synthesisTask: ScheduledTask | null = null;

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
    console.log(
      `[Scheduler] Heartbeat completed in ${duration}ms - ` +
      `created: ${result.entitiesCreated}, updated: ${result.entitiesUpdated}, ` +
      `reindexed: ${result.reindexed}`
    );

    // Log to database (visible on System page)
    await logActivity({
      eventType: 'heartbeat_run',
      actor: 'system',
      description: `Heartbeat: ${result.entitiesCreated} created, ${result.entitiesUpdated} updated`,
      metadata: {
        trigger: 'scheduled',
        success: result.allStepsSucceeded,
        entitiesCreated: result.entitiesCreated,
        entitiesUpdated: result.entitiesUpdated,
        reindexed: result.reindexed,
        entities: result.entities,
        extractionMethod: result.extractionMethod,
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
          entitiesCreated: 0,
          entitiesUpdated: 0,
          reindexed: false,
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

// ============================================================================
// SYNTHESIS SCHEDULING
// ============================================================================

/**
 * Get synthesis schedule hour from environment or use default
 */
function getSynthesisHour(): number {
  const envHour = process.env.SYNTHESIS_HOUR;
  if (envHour) {
    const parsed = parseInt(envHour, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      return parsed;
    }
  }
  return 3; // Default: 3 AM
}

/**
 * Check if synthesis scheduling is enabled
 */
function isSynthesisEnabled(): boolean {
  const enabled = process.env.SYNTHESIS_ENABLED;
  // Enabled by default, only disable if explicitly set to 'false'
  return enabled !== 'false';
}

/**
 * Run synthesis with error handling
 */
async function runSynthesisSafe(): Promise<void> {
  const startTime = Date.now();
  console.log(`[Scheduler] Running scheduled synthesis at ${new Date().toISOString()}`);

  try {
    const { runWeeklySynthesis } = await import('./memory/synthesis');
    const { logActivity } = await import('./activity');

    const result = await runWeeklySynthesis();

    const duration = Date.now() - startTime;
    console.log(
      `[Scheduler] Synthesis completed in ${duration}ms - ` +
      `processed: ${result.entitiesProcessed}, archived: ${result.factsArchived}, ` +
      `regenerated: ${result.summariesRegenerated}`
    );

    // Log to database (visible on System page)
    await logActivity({
      eventType: 'synthesis_run',
      actor: 'system',
      description: `Synthesis: ${result.factsArchived} archived, ${result.summariesRegenerated} regenerated`,
      metadata: {
        trigger: 'scheduled',
        success: result.errors.length === 0,
        entitiesProcessed: result.entitiesProcessed,
        factsArchived: result.factsArchived,
        summariesRegenerated: result.summariesRegenerated,
        duration,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Scheduler] Synthesis failed after ${duration}ms:`, error);

    try {
      const { logActivity } = await import('./activity');
      await logActivity({
        eventType: 'synthesis_run',
        actor: 'system',
        description: `Synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          trigger: 'scheduled',
          success: false,
          entitiesProcessed: 0,
          factsArchived: 0,
          summariesRegenerated: 0,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (logError) {
      console.error('[Scheduler] Failed to log synthesis failure:', logError);
    }
  }
}

/**
 * Start the synthesis scheduler
 *
 * Runs daily at the configured hour (default 3 AM).
 * Safe to call multiple times (will only schedule once).
 */
export function startSynthesisScheduler(): void {
  // Prevent duplicate scheduling
  if (synthesisScheduled) {
    console.log('[Scheduler] Synthesis already scheduled, skipping');
    return;
  }

  // Check if enabled
  if (!isSynthesisEnabled()) {
    console.log('[Scheduler] Synthesis scheduling disabled via SYNTHESIS_ENABLED=false');
    return;
  }

  const hour = getSynthesisHour();

  // Create cron expression: "0 3 * * *" means 3:00 AM daily
  const cronExpression = `0 ${hour} * * *`;

  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  // Schedule the task
  synthesisTask = cron.schedule(cronExpression, () => {
    // Run async without blocking
    runSynthesisSafe().catch(err => {
      console.error('[Scheduler] Unhandled error in synthesis:', err);
    });
  });

  synthesisScheduled = true;
  console.log(`[Scheduler] Synthesis scheduled: daily at ${hour}:00`);
}

/**
 * Stop the synthesis scheduler
 */
export function stopSynthesisScheduler(): void {
  if (synthesisTask) {
    synthesisTask.stop();
    synthesisTask = null;
    synthesisScheduled = false;
    console.log('[Scheduler] Synthesis scheduler stopped');
  }
}

/**
 * Check if synthesis is currently scheduled
 */
export function isSynthesisScheduled(): boolean {
  return synthesisScheduled;
}

/**
 * Manually trigger synthesis (outside of schedule)
 */
export async function triggerSynthesis(): Promise<void> {
  console.log('[Scheduler] Manual synthesis trigger');
  await runSynthesisSafe();
}

// ============================================================================
// COMBINED SCHEDULER CONTROL
// ============================================================================

/**
 * Start all schedulers
 */
export function startAllSchedulers(): void {
  startHeartbeatScheduler();
  startSynthesisScheduler();
}

/**
 * Stop all schedulers
 */
export function stopAllSchedulers(): void {
  stopHeartbeatScheduler();
  stopSynthesisScheduler();
}
