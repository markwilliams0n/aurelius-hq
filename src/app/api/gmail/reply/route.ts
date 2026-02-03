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
// Maximum reply body length (100KB should be plenty for email)
const MAX_BODY_LENGTH = 100 * 1024;

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

    // Validate body length
    if (body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `body exceeds maximum length of ${MAX_BODY_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Sanitize: trim whitespace
    const sanitizedBody = body.trim();
    if (!sanitizedBody) {
      return NextResponse.json(
        { error: 'body cannot be empty' },
        { status: 400 }
      );
    }

    const result = await replyToEmail(itemId, sanitizedBody, { replyAll, forceDraft });

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
