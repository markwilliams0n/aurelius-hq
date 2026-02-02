import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../webhook/route';

// Mock the handler
vi.mock('@/lib/telegram/handler', () => ({
  handleTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

import { handleTelegramUpdate } from '@/lib/telegram/handler';

describe('Telegram Webhook API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/telegram/webhook', () => {
    it('returns health check response', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.message).toContain('active');
    });
  });

  describe('POST /api/telegram/webhook', () => {
    it('accepts valid update', async () => {
      const update = {
        update_id: 123,
        message: {
          message_id: 1,
          chat: { id: 456, type: 'private' },
          text: 'Hello',
          date: Date.now(),
        },
      };

      const request = new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it('calls handleTelegramUpdate with the update', async () => {
      const update = {
        update_id: 123,
        message: {
          message_id: 1,
          chat: { id: 456, type: 'private' },
          text: 'Hello',
          date: Date.now(),
        },
      };

      const request = new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      await POST(request);

      // Wait a tick for the async handler to be called
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handleTelegramUpdate).toHaveBeenCalledWith(update);
    });

    it('returns 400 for invalid content type', async () => {
      const request = new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid content type');
    });

    it('returns 200 even on handler errors to prevent retries', async () => {
      vi.mocked(handleTelegramUpdate).mockRejectedValueOnce(new Error('Handler error'));

      const update = {
        update_id: 123,
        message: {
          message_id: 1,
          chat: { id: 456, type: 'private' },
          text: 'Hello',
          date: Date.now(),
        },
      };

      const request = new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      const response = await POST(request);

      // Should still return 200 to prevent Telegram retries
      expect(response.status).toBe(200);
    });

    it('returns 200 on invalid JSON to prevent retries', async () => {
      const request = new Request('http://localhost/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      const response = await POST(request);
      const data = await response.json();

      // Should return 200 to prevent retries
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });
});
