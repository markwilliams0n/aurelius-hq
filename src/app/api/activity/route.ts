import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { activityLog } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * GET /api/activity - Fetch activity log from database
 * Query params:
 *   - eventType: filter by event type (e.g., "triage_action")
 *   - limit: max number of entries (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('eventType');
    const limit = parseInt(searchParams.get('limit') || '50');

    const activities = eventType
      ? await db
          .select()
          .from(activityLog)
          .where(eq(activityLog.eventType, eventType as any))
          .orderBy(desc(activityLog.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(activityLog)
          .orderBy(desc(activityLog.createdAt))
          .limit(limit);

    return NextResponse.json({ activities });
  } catch (error) {
    console.error('Failed to read activity log:', error);
    return NextResponse.json(
      { error: 'Failed to read activity log', activities: [] },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/activity - Clear activity log (dangerous - probably don't use)
 */
export async function DELETE() {
  try {
    await db.delete(activityLog);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to clear activity log:', error);
    return NextResponse.json(
      { error: 'Failed to clear activity log' },
      { status: 500 }
    );
  }
}
