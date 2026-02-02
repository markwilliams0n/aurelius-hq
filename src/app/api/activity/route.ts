import { NextResponse } from 'next/server';
import { readActivityLog, clearActivityLog } from '@/lib/memory/activity-log';

export const runtime = 'nodejs';

/**
 * GET /api/activity - Fetch activity log
 */
export async function GET() {
  try {
    const log = await readActivityLog();
    return NextResponse.json(log);
  } catch (error) {
    console.error('Failed to read activity log:', error);
    return NextResponse.json(
      { error: 'Failed to read activity log', entries: [] },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/activity - Clear activity log
 */
export async function DELETE() {
  try {
    await clearActivityLog();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to clear activity log:', error);
    return NextResponse.json(
      { error: 'Failed to clear activity log' },
      { status: 500 }
    );
  }
}
