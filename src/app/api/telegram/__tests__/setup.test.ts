import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../setup/route';

// Mock the telegram client
vi.mock('@/lib/telegram/client', () => ({
  getMe: vi.fn().mockResolvedValue({
    id: 123456789,
    username: 'testbot',
    first_name: 'Test Bot',
    is_bot: true,
  }),
  getWebhookInfo: vi.fn().mockResolvedValue({
    url: '',
    has_custom_certificate: false,
    pending_update_count: 0,
  }),
  setWebhook: vi.fn().mockResolvedValue(true),
  deleteWebhook: vi.fn().mockResolvedValue(true),
}));

import { getMe, getWebhookInfo, setWebhook, deleteWebhook } from '@/lib/telegram/client';

describe('Telegram Setup API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('GET /api/telegram/setup', () => {
    it('returns bot and webhook info', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.bot).toBeDefined();
      expect(data.bot.id).toBe(123456789);
      expect(data.bot.username).toBe('testbot');
      expect(data.webhook).toBeDefined();
      expect(data.webhook.isSet).toBe(false);
    });

    it('indicates when webhook is set', async () => {
      vi.mocked(getWebhookInfo).mockResolvedValueOnce({
        url: 'https://example.com/api/telegram/webhook',
        has_custom_certificate: false,
        pending_update_count: 0,
      });

      const response = await GET();
      const data = await response.json();

      expect(data.webhook.isSet).toBe(true);
      expect(data.webhook.url).toBe('https://example.com/api/telegram/webhook');
    });

    it('includes error info from webhook', async () => {
      vi.mocked(getWebhookInfo).mockResolvedValueOnce({
        url: 'https://example.com/api/telegram/webhook',
        has_custom_certificate: false,
        pending_update_count: 5,
        last_error_date: 1704067200,
        last_error_message: 'Connection timeout',
      });

      const response = await GET();
      const data = await response.json();

      expect(data.webhook.lastError).toBe('Connection timeout');
      expect(data.webhook.pendingUpdates).toBe(5);
    });

    it('handles API errors', async () => {
      vi.mocked(getMe).mockRejectedValueOnce(new Error('API error'));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('API error');
    });
  });

  describe('POST /api/telegram/setup', () => {
    describe('action: set', () => {
      it('sets webhook with auto-generated URL', async () => {
        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.webhookUrl).toBe('https://example.com/api/telegram/webhook');
        expect(setWebhook).toHaveBeenCalledWith('https://example.com/api/telegram/webhook');
      });

      it('sets webhook with provided URL', async () => {
        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set',
            webhookUrl: 'https://custom.domain.com/webhook',
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.webhookUrl).toBe('https://custom.domain.com/webhook');
        expect(setWebhook).toHaveBeenCalledWith('https://custom.domain.com/webhook');
      });

      it('returns error when APP_URL not configured', async () => {
        delete process.env.NEXT_PUBLIC_APP_URL;

        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('NEXT_PUBLIC_APP_URL');
      });

      it('handles setWebhook errors', async () => {
        vi.mocked(setWebhook).mockRejectedValueOnce(new Error('Failed to set webhook'));

        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Failed to set webhook');
      });
    });

    describe('action: delete', () => {
      it('deletes the webhook', async () => {
        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(deleteWebhook).toHaveBeenCalled();
      });

      it('handles deleteWebhook errors', async () => {
        vi.mocked(deleteWebhook).mockRejectedValueOnce(new Error('Failed to delete'));

        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Failed to delete');
      });
    });

    describe('invalid action', () => {
      it('returns error for unknown action', async () => {
        const request = new Request('http://localhost/api/telegram/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'invalid' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toContain('Invalid action');
      });
    });
  });
});
