import { NextRequest, NextResponse } from 'next/server';
import { runHeartbeat, type HeartbeatOptions } from '@/lib/memory/heartbeat';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/heartbeat
 *
 * Run the heartbeat process to sync connectors.
 *
 * Body options:
 * - trigger: 'manual' | 'auto' | 'scheduled' (for logging)
 * - skipGranola: boolean - skip Granola meeting sync
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

    if (body.skipGranola !== undefined) options.skipGranola = body.skipGranola;
  } catch {
    // No body, use defaults
  }

  try {
    const result = await runHeartbeat(options);
    const duration = Date.now() - startTime;

    // Log to activity database
    await logActivity({
      eventType: 'heartbeat_run',
      actor: 'system',
      description: `Heartbeat: connector sync complete`,
      metadata: {
        trigger,
        success: result.allStepsSucceeded,
        steps: result.steps,
        gmail: result.gmail,
        granola: result.granola,
        warnings: result.warnings,
        duration,
        error: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
      },
    });

    return NextResponse.json({
      success: result.allStepsSucceeded,
      ...result,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Heartbeat error:', error);

    // Log failure to activity database
    await logActivity({
      eventType: 'heartbeat_run',
      actor: 'system',
      description: `Heartbeat failed: ${String(error)}`,
      metadata: {
        trigger,
        success: false,
        duration,
        error: String(error),
      },
    });

    return NextResponse.json(
      { success: false, error: 'Heartbeat failed', details: String(error), duration },
      { status: 500 }
    );
  }
}

/**
 * GET /api/heartbeat
 *
 * Run heartbeat with default options.
 */
export async function GET(request: NextRequest) {
  const syntheticRequest = new NextRequest(request.url, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });

  return POST(syntheticRequest);
}
