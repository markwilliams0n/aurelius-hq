import { NextResponse } from 'next/server';
import { startSocketMode, stopSocketMode, getSocketStatus } from '@/lib/slack';

export const runtime = 'nodejs';

/**
 * GET /api/slack/socket
 *
 * Get Socket Mode connection status.
 */
export async function GET() {
  const status = getSocketStatus();
  return NextResponse.json(status);
}

/**
 * POST /api/slack/socket
 *
 * Start Socket Mode connection.
 */
export async function POST() {
  try {
    await startSocketMode();
    return NextResponse.json({ success: true, ...getSocketStatus() });
  } catch (error) {
    console.error('[Slack API] Failed to start Socket Mode:', error);
    return NextResponse.json(
      { error: 'Failed to start Socket Mode', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/slack/socket
 *
 * Stop Socket Mode connection.
 */
export async function DELETE() {
  try {
    await stopSocketMode();
    return NextResponse.json({ success: true, ...getSocketStatus() });
  } catch (error) {
    console.error('[Slack API] Failed to stop Socket Mode:', error);
    return NextResponse.json(
      { error: 'Failed to stop Socket Mode', details: String(error) },
      { status: 500 }
    );
  }
}
