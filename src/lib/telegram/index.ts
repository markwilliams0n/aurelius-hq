/**
 * Telegram Bot Integration for Aurelius
 *
 * This module provides Telegram bot functionality for chatting with Aurelius.
 *
 * Setup:
 * 1. Set TELEGRAM_BOT_TOKEN in your .env.local
 * 2. Deploy your app to a public URL (Telegram requires HTTPS)
 * 3. Call POST /api/telegram/setup with { action: 'set' } to configure the webhook
 *
 * Or manually set the webhook:
 * curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<YOUR_APP_URL>/api/telegram/webhook"
 */

export * from './client';
export * from './handler';
