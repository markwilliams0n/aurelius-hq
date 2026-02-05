import { NextResponse } from 'next/server';
import { syncSlackMessages } from '@/lib/slack';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes

/**
 * POST /api/slack/sync
 *
 * Manually trigger Slack message sync.
 */
export async function POST() {
  try {
    const result = await syncSlackMessages();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Slack API] Sync failed:', error);
    return NextResponse.json(
      { error: 'Slack sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/slack/sync
 *
 * Same as POST for convenience.
 */
export async function GET() {
  return POST();
}
