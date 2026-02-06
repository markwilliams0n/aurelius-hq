import { NextResponse } from 'next/server';
import { readActivityLog } from '@/lib/memory/activity-log';
import { isHeartbeatScheduled } from '@/lib/scheduler';

export const runtime = 'nodejs';

/**
 * GET /api/heartbeat/status
 *
 * Returns heartbeat and synthesis health status including:
 * - Whether schedulers are running
 * - Last run time and result
 * - Recent history
 */
export async function GET() {
  const activityLog = await readActivityLog();

  // Filter to heartbeat entries only
  const heartbeatEntries = activityLog.entries.filter(e => e.type === 'heartbeat');

  // Get the most recent heartbeat
  const lastHeartbeat = heartbeatEntries[0] || null;

  // Calculate time since last heartbeat
  let timeSinceLastHeartbeat: number | null = null;
  let lastHeartbeatAge: string | null = null;
  if (lastHeartbeat) {
    timeSinceLastHeartbeat = Date.now() - new Date(lastHeartbeat.timestamp).getTime();
    lastHeartbeatAge = formatDuration(timeSinceLastHeartbeat);
  }

  // Count recent successes/failures (last 10)
  const recent = heartbeatEntries.slice(0, 10);
  const recentSuccesses = recent.filter(e => e.success).length;
  const recentFailures = recent.length - recentSuccesses;

  // Determine overall health
  let health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown';
  if (heartbeatEntries.length === 0) {
    health = 'unknown';
  } else if (lastHeartbeat?.success && recentFailures <= 1) {
    health = 'healthy';
  } else if (recentFailures >= 3 || !lastHeartbeat?.success) {
    health = 'unhealthy';
  } else {
    health = 'degraded';
  }

  // Check if schedulers are running
  let heartbeatSchedulerRunning = false;
  try {
    heartbeatSchedulerRunning = isHeartbeatScheduled();
  } catch {
    // Scheduler module may not be loaded in some contexts
  }

  return NextResponse.json({
    heartbeat: {
      health,
      schedulerRunning: heartbeatSchedulerRunning,
      lastRun: lastHeartbeat ? {
        timestamp: lastHeartbeat.timestamp,
        age: lastHeartbeatAge,
        ageMs: timeSinceLastHeartbeat,
        success: lastHeartbeat.success,
        trigger: lastHeartbeat.trigger,
        duration: lastHeartbeat.duration,
        error: lastHeartbeat.error,
      } : null,
      recentStats: {
        total: recent.length,
        successes: recentSuccesses,
        failures: recentFailures,
        successRate: recent.length > 0 ? Math.round((recentSuccesses / recent.length) * 100) : 0,
      },
      recentRuns: heartbeatEntries.slice(0, 5).map(e => ({
        timestamp: e.timestamp,
        success: e.success,
        trigger: e.trigger,
        duration: e.duration,
        error: e.error,
      })),
    },
    health,
    schedulerRunning: heartbeatSchedulerRunning,
    lastHeartbeat: lastHeartbeat ? {
      timestamp: lastHeartbeat.timestamp,
      age: lastHeartbeatAge,
      ageMs: timeSinceLastHeartbeat,
      success: lastHeartbeat.success,
      trigger: lastHeartbeat.trigger,
      duration: lastHeartbeat.duration,
      error: lastHeartbeat.error,
    } : null,
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ago`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s ago`;
  } else {
    return `${seconds}s ago`;
  }
}
