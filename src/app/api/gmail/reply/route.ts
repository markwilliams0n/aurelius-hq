import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
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
 * - to: string (optional) - Override To recipients
 * - cc: string (optional) - CC recipients
 * - bcc: string (optional) - BCC recipients
 */
// Maximum reply body length (100KB should be plenty for email)
const MAX_BODY_LENGTH = 100 * 1024;

// Basic email validation for comma-separated lists
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmailList(value: string): boolean {
  if (!value.trim()) return true;
  return value.split(',').every(e => EMAIL_REGEX.test(e.trim()));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const json = await request.json();
    const { itemId, body, replyAll, forceDraft, to, cc, bcc } = json;

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

    // Validate email addresses if provided
    const toStr = typeof to === 'string' ? to.trim() : undefined;
    const ccStr = typeof cc === 'string' ? cc.trim() : undefined;
    const bccStr = typeof bcc === 'string' ? bcc.trim() : undefined;

    if (toStr && !validateEmailList(toStr)) {
      return NextResponse.json({ error: 'Invalid To email address' }, { status: 400 });
    }
    if (ccStr && !validateEmailList(ccStr)) {
      return NextResponse.json({ error: 'Invalid CC email address' }, { status: 400 });
    }
    if (bccStr && !validateEmailList(bccStr)) {
      return NextResponse.json({ error: 'Invalid BCC email address' }, { status: 400 });
    }

    const result = await replyToEmail(itemId, sanitizedBody, {
      replyAll,
      forceDraft,
      to: toStr || undefined,
      cc: ccStr || undefined,
      bcc: bccStr || undefined,
    });

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
