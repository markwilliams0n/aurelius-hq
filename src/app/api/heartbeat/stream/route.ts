import { NextRequest } from 'next/server';
import { runHeartbeat, type HeartbeatOptions, type HeartbeatStep, type HeartbeatStepStatus } from '@/lib/memory/heartbeat';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/heartbeat/stream
 *
 * Run heartbeat with SSE progress streaming.
 * Sends events as each step starts/completes.
 *
 * Event format: { step, status, detail? }
 * Final event: { done: true, result: HeartbeatResult }
 */
export async function POST(request: NextRequest) {
  let options: HeartbeatOptions = {};

  try {
    const body = await request.json().catch(() => ({}));
    if (body.skipGranola !== undefined) options.skipGranola = body.skipGranola;
  } catch {
    // No body, use defaults
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      const onProgress = (step: HeartbeatStep, status: HeartbeatStepStatus, detail?: string) => {
        send({ step, status, detail });
      };

      const startTime = Date.now();

      try {
        const result = await runHeartbeat({ ...options, onProgress });
        const duration = Date.now() - startTime;

        // Log to database
        await logActivity({
          eventType: 'heartbeat_run',
          actor: 'system',
          description: `Heartbeat: connector sync complete`,
          metadata: {
            trigger: 'manual',
            success: result.allStepsSucceeded,
            steps: result.steps,
            gmail: result.gmail,
            granola: result.granola,
            warnings: result.warnings,
            duration,
            error: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
          },
        });

        send({ done: true, result: { ...result, duration } });
      } catch (error) {
        const duration = Date.now() - startTime;
        send({ done: true, error: String(error), duration });

        try {
          await logActivity({
            eventType: 'heartbeat_run',
            actor: 'system',
            description: `Heartbeat failed: ${String(error)}`,
            metadata: {
              trigger: 'manual',
              success: false,
              duration,
              error: String(error),
            },
          });
        } catch (logError) {
          console.error('[Heartbeat Stream] Failed to log heartbeat failure:', logError);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
