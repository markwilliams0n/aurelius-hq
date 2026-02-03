import { NextResponse } from 'next/server';
import { syncGmailMessages } from '@/lib/gmail';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes

/**
 * POST /api/gmail/sync
 *
 * Manually trigger Gmail sync.
 */
export async function POST() {
  try {
    const result = await syncGmailMessages();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Gmail API] Sync failed:', error);
    return NextResponse.json(
      { error: 'Gmail sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gmail/sync
 *
 * Same as POST for convenience.
 */
export async function GET() {
  return POST();
}
