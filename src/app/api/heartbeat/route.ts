import { NextRequest, NextResponse } from 'next/server';
import { runHeartbeat, type HeartbeatOptions } from '@/lib/memory/heartbeat';
import { appendActivityLog, HeartbeatLogEntry } from '@/lib/memory/activity-log';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes - heartbeat can be slow with QMD embed

/**
 * POST /api/heartbeat
 *
 * Run the heartbeat process to sync memory.
 *
 * Body options:
 * - trigger: 'manual' | 'auto' | 'scheduled' (for logging)
 * - skipReindex: boolean - skip QMD reindex (faster, but new content not searchable)
 * - skipGranola: boolean - skip Granola meeting sync
 * - skipExtraction: boolean - skip entity extraction from daily notes
 * - quick: boolean - shorthand for skipReindex (for fast partial heartbeats)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Parse options from request body
  let trigger: 'manual' | 'auto' | 'scheduled' = 'manual';
  let options: HeartbeatOptions = {};

  try {
    const body = await request.json().catch(() => ({}));

    if (body.trigger === 'auto' || body.trigger === 'scheduled') {
      trigger = body.trigger;
    }

    // Support both explicit options and 'quick' shorthand
    if (body.quick) {
      options.skipReindex = true;
    }
    if (body.skipReindex !== undefined) options.skipReindex = body.skipReindex;
    if (body.skipGranola !== undefined) options.skipGranola = body.skipGranola;
    if (body.skipExtraction !== undefined) options.skipExtraction = body.skipExtraction;
  } catch {
    // No body, use defaults
  }

  try {
    const result = await runHeartbeat(options);
    const duration = Date.now() - startTime;

    // Log to activity log
    const logEntry: HeartbeatLogEntry = {
      id: `hb-${Date.now()}`,
      type: 'heartbeat',
      trigger,
      success: result.allStepsSucceeded,
      entitiesCreated: result.entitiesCreated,
      entitiesUpdated: result.entitiesUpdated,
      reindexed: result.reindexed,
      entities: result.entities,
      extractionMethod: result.extractionMethod,
      duration,
      timestamp: new Date().toISOString(),
      error: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
    };
    await appendActivityLog(logEntry);

    return NextResponse.json({
      success: result.allStepsSucceeded,
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
      trigger,
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

/**
 * GET /api/heartbeat
 *
 * Run heartbeat with default options. Supports query params:
 * - quick=true - skip QMD reindex for faster execution
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const quick = searchParams.get('quick') === 'true';

  // Convert to POST with appropriate body
  const syntheticRequest = new NextRequest(request.url, {
    method: 'POST',
    body: JSON.stringify({ quick }),
    headers: { 'Content-Type': 'application/json' },
  });

  return POST(syntheticRequest);
}
