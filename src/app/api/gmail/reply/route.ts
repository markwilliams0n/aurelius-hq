import { NextRequest, NextResponse } from 'next/server';
import { replyToEmail } from '@/lib/gmail/actions';

export const runtime = 'nodejs';

/**
 * POST /api/gmail/reply
 *
 * Create a reply (draft or send based on settings).
 *
 * Body:
 * - itemId: string (required) - The triage item ID
 * - body: string (required) - Reply body text
 * - replyAll: boolean (optional) - Reply to all recipients
 * - forceDraft: boolean (optional) - Force draft even if sending enabled
 */
export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const { itemId, body, replyAll, forceDraft } = json;

    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json(
        { error: 'itemId is required' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'string') {
      return NextResponse.json(
        { error: 'body is required' },
        { status: 400 }
      );
    }

    const result = await replyToEmail(itemId, body, { replyAll, forceDraft });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Gmail API] Reply failed:', error);
    return NextResponse.json(
      { error: 'Reply failed', details: String(error) },
      { status: 500 }
    );
  }
}
