import { NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/telegram/handler';
import type { TelegramUpdate } from '@/lib/telegram/client';

/**
 * POST /api/telegram/webhook
 *
 * Receives webhook updates from Telegram
 */
export async function POST(request: Request) {
  try {
    // Verify the request has the correct content type
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
    }

    // Parse the update
    const update: TelegramUpdate = await request.json();

    // Process the update asynchronously
    // We respond immediately to Telegram and process in background
    handleTelegramUpdate(update).catch((error) => {
      console.error('Error handling Telegram update:', error);
    });

    // Always return 200 OK to Telegram
    // If we return an error, Telegram will retry the request
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error parsing Telegram webhook:', error);
    // Still return 200 to prevent retries
    return NextResponse.json({ ok: true });
  }
}

/**
 * GET /api/telegram/webhook
 *
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Telegram webhook endpoint is active',
  });
}
