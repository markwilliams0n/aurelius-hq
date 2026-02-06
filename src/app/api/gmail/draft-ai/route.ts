import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { chat } from '@/lib/ai/client';

export const runtime = 'nodejs';

/**
 * POST /api/gmail/draft-ai
 *
 * Generate an AI-drafted reply using Kimi via OpenRouter.
 *
 * Body:
 * - itemId: string (required) - The triage item ID
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { itemId } = await request.json();

    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, itemId))
      .limit(1);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Truncate content to avoid sending huge emails to the LLM
    const content = item.content.slice(0, 4000);

    const draft = await chat(
      `Write a professional email reply to the following email.

From: ${item.senderName || item.sender}
Subject: ${item.subject}

---
${content}
---

Write ONLY the reply body text. No subject line, no greeting preamble like "Here's a draft". Start directly with an appropriate greeting (e.g. "Hi [Name],") and end with a sign-off. Keep it concise and professional.`,
      'You are drafting email replies on behalf of the user. Output ONLY the email body text, nothing else. No markdown formatting.'
    );

    return NextResponse.json({ draft: draft.trim() });
  } catch (error) {
    console.error('[Gmail AI Draft] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate draft' },
      { status: 500 }
    );
  }
}
