import { NextResponse } from 'next/server';
import { syncGmailMessages } from '@/lib/gmail';
import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, like, and } from 'drizzle-orm';

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

/**
 * DELETE /api/gmail/sync
 *
 * Clear fake Gmail data and resync from real Gmail.
 * Deletes items with externalId starting with 'email-' (fake data pattern).
 */
export async function DELETE() {
  try {
    // Delete fake Gmail items (they have externalId like 'email-timestamp-index')
    const deleted = await db
      .delete(inboxItems)
      .where(
        and(
          eq(inboxItems.connector, 'gmail'),
          like(inboxItems.externalId, 'email-%')
        )
      )
      .returning({ id: inboxItems.id });

    console.log(`[Gmail] Deleted ${deleted.length} fake Gmail items`);

    // Now sync real Gmail
    const result = await syncGmailMessages();

    return NextResponse.json({
      cleared: deleted.length,
      ...result,
    });
  } catch (error) {
    console.error('[Gmail API] Clear and sync failed:', error);
    return NextResponse.json(
      { error: 'Clear and sync failed', details: String(error) },
      { status: 500 }
    );
  }
}
