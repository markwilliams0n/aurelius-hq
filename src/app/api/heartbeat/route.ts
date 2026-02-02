import { NextResponse } from 'next/server';
import { runHeartbeat } from '@/lib/memory/heartbeat';
import { appendActivityLog, HeartbeatLogEntry } from '@/lib/memory/activity-log';

export const runtime = 'nodejs';
export const maxDuration = 120; // Allow up to 2 minutes for heartbeat

export async function POST() {
  const startTime = Date.now();

  try {
    const result = await runHeartbeat();
    const duration = Date.now() - startTime;

    // Log to activity log
    const logEntry: HeartbeatLogEntry = {
      id: `hb-${Date.now()}`,
      type: 'heartbeat',
      success: true,
      entitiesCreated: result.entitiesCreated,
      entitiesUpdated: result.entitiesUpdated,
      reindexed: result.reindexed,
      entities: result.entities,
      extractionMethod: result.extractionMethod,
      duration,
      timestamp: new Date().toISOString(),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json({
      success: true,
      ...result,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Heartbeat error:', error);

    // Log failure to activity log
    const logEntry: HeartbeatLogEntry = {
      id: `hb-${Date.now()}`,
      type: 'heartbeat',
      success: false,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      reindexed: false,
      entities: [],
      extractionMethod: 'pattern',
      duration,
      timestamp: new Date().toISOString(),
      error: String(error),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json(
      { success: false, error: 'Heartbeat failed', details: String(error), duration },
      { status: 500 }
    );
  }
}

// Also allow GET for easy testing
export async function GET() {
  return POST();
}
