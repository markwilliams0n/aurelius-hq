import { NextResponse } from 'next/server';
import { syncLinearNotifications } from '@/lib/linear';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes

/**
 * POST /api/linear/sync
 *
 * Manually trigger Linear notification sync.
 */
export async function POST() {
  try {
    const result = await syncLinearNotifications();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Linear API] Sync failed:', error);
    return NextResponse.json(
      { error: 'Linear sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/linear/sync
 *
 * Same as POST for convenience.
 */
export async function GET() {
  return POST();
}
