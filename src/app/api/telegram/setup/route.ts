import { NextResponse } from 'next/server';
import {
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  getMe,
} from '@/lib/telegram/client';

/**
 * GET /api/telegram/setup
 *
 * Get current webhook status and bot info
 */
export async function GET() {
  try {
    const [botInfo, webhookInfo] = await Promise.all([getMe(), getWebhookInfo()]);

    return NextResponse.json({
      bot: {
        id: botInfo.id,
        username: botInfo.username,
        firstName: botInfo.first_name,
      },
      webhook: {
        url: webhookInfo.url || null,
        isSet: !!webhookInfo.url,
        pendingUpdates: webhookInfo.pending_update_count,
        lastError: webhookInfo.last_error_message || null,
        lastErrorDate: webhookInfo.last_error_date
          ? new Date(webhookInfo.last_error_date * 1000).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error('Error getting Telegram setup info:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bot info' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/telegram/setup
 *
 * Configure the Telegram webhook
 *
 * Body:
 * - action: 'set' | 'delete'
 * - webhookUrl?: string (required for 'set', uses APP_URL/api/telegram/webhook if not provided)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, webhookUrl } = body;

    if (action === 'delete') {
      await deleteWebhook();
      return NextResponse.json({
        success: true,
        message: 'Webhook deleted successfully',
      });
    }

    if (action === 'set') {
      // Use provided URL or construct from APP_URL
      let url = webhookUrl;
      if (!url) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        if (!appUrl) {
          return NextResponse.json(
            { error: 'NEXT_PUBLIC_APP_URL is not configured' },
            { status: 400 }
          );
        }
        url = `${appUrl}/api/telegram/webhook`;
      }

      await setWebhook(url);

      return NextResponse.json({
        success: true,
        message: 'Webhook set successfully',
        webhookUrl: url,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "set" or "delete"' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error configuring Telegram webhook:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to configure webhook' },
      { status: 500 }
    );
  }
}
