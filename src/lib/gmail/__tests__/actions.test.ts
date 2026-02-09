import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env values
const originalEnv = { ...process.env };

// Set up environment before mocks
beforeEach(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH = '/mock/path/service-account.json';
  process.env.GOOGLE_IMPERSONATE_EMAIL = 'mark@rostr.cc';
  process.env.GMAIL_ENABLE_SEND = 'false';
});

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv };
});

// Mock database item
const mockGmailItem = {
  id: 'item-123',
  connector: 'gmail',
  externalId: 'thread-123',
  sender: 'sender@example.com',
  senderName: 'Test Sender',
  subject: 'Test Email',
  content: 'Test content',
  status: 'new',
  rawPayload: {
    messageId: 'msg-123',
    rfc822MessageId: '<msg-123@mail.gmail.com>',
    threadId: 'thread-123',
    unsubscribeUrl: 'https://example.com/unsubscribe',
  },
};

const mockNonGmailItem = {
  ...mockGmailItem,
  id: 'item-456',
  connector: 'slack',
};

// Mock the queries module (findInboxItem) instead of db directly
const mockFindInboxItem = vi.fn();
vi.mock('../queries', () => ({
  findInboxItem: (...args: unknown[]) => mockFindInboxItem(...args),
}));

// Mock Gmail client functions
vi.mock('../client', () => ({
  archiveEmail: vi.fn(() => Promise.resolve()),
  markAsSpam: vi.fn(() => Promise.resolve()),
  addLabel: vi.fn(() => Promise.resolve()),
  createDraft: vi.fn(() => Promise.resolve('draft-123')),
  sendEmail: vi.fn(() => Promise.resolve('sent-msg-123')),
}));

import {
  syncArchiveToGmail,
  syncSpamToGmail,
  replyToEmail,
  getUnsubscribeUrl,
} from '../actions';
import { archiveEmail, markAsSpam, createDraft, sendEmail } from '../client';

describe('Gmail Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: findInboxItem returns the gmail item
    mockFindInboxItem.mockResolvedValue(mockGmailItem);
  });

  describe('syncArchiveToGmail', () => {
    it('archives Gmail item in Gmail', async () => {
      await syncArchiveToGmail('item-123');

      expect(archiveEmail).toHaveBeenCalledWith('msg-123');
    });

    it('skips non-Gmail items', async () => {
      mockFindInboxItem.mockResolvedValue(mockNonGmailItem);

      await syncArchiveToGmail('item-456');

      expect(archiveEmail).not.toHaveBeenCalled();
    });

    it('handles item not found', async () => {
      mockFindInboxItem.mockResolvedValue(null);

      // Should not throw
      await syncArchiveToGmail('nonexistent-item');

      expect(archiveEmail).not.toHaveBeenCalled();
    });

    it('handles missing messageId gracefully', async () => {
      mockFindInboxItem.mockResolvedValue({
        ...mockGmailItem,
        rawPayload: {},
      });

      // Should not throw
      await syncArchiveToGmail('item-123');

      expect(archiveEmail).not.toHaveBeenCalled();
    });

    it('propagates Gmail API errors', async () => {
      vi.mocked(archiveEmail).mockRejectedValueOnce(new Error('API Error'));

      await expect(syncArchiveToGmail('item-123')).rejects.toThrow('API Error');
    });
  });

  describe('syncSpamToGmail', () => {
    it('marks Gmail item as spam in Gmail', async () => {
      await syncSpamToGmail('item-123');

      expect(markAsSpam).toHaveBeenCalledWith('msg-123');
    });

    it('skips non-Gmail items', async () => {
      mockFindInboxItem.mockResolvedValue(mockNonGmailItem);

      await syncSpamToGmail('item-456');

      expect(markAsSpam).not.toHaveBeenCalled();
    });
  });

  describe('replyToEmail', () => {
    beforeEach(() => {
      process.env.GMAIL_ENABLE_SEND = 'false';
    });

    it('creates draft by default', async () => {
      const result = await replyToEmail('item-123', 'Reply body');

      expect(result.wasDraft).toBe(true);
      expect(result.draftId).toBe('draft-123');
      expect(createDraft).toHaveBeenCalledWith({
        threadId: 'thread-123',
        to: 'sender@example.com',
        subject: 'Re: Test Email',
        body: 'Reply body',
        inReplyTo: '<msg-123@mail.gmail.com>',
        cc: undefined,
        bcc: undefined,
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('creates draft when forceDraft is true', async () => {
      process.env.GMAIL_ENABLE_SEND = 'true';

      const result = await replyToEmail('item-123', 'Reply body', {
        forceDraft: true,
      });

      expect(result.wasDraft).toBe(true);
      expect(createDraft).toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends email when GMAIL_ENABLE_SEND is true and forceDraft is false', async () => {
      process.env.GMAIL_ENABLE_SEND = 'true';

      const result = await replyToEmail('item-123', 'Reply body', {
        forceDraft: false,
      });

      expect(result.wasDraft).toBe(false);
      expect(result.messageId).toBe('sent-msg-123');
      expect(sendEmail).toHaveBeenCalledWith({
        threadId: 'thread-123',
        to: 'sender@example.com',
        subject: 'Re: Test Email',
        body: 'Reply body',
        inReplyTo: '<msg-123@mail.gmail.com>',
        cc: undefined,
        bcc: undefined,
      });
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('preserves Re: prefix if already present', async () => {
      mockFindInboxItem.mockResolvedValue({
        ...mockGmailItem,
        subject: 'Re: Already a reply',
      });

      await replyToEmail('item-123', 'Reply body');

      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Re: Already a reply',
        })
      );
    });

    it('throws for non-Gmail items', async () => {
      mockFindInboxItem.mockResolvedValue(mockNonGmailItem);

      await expect(replyToEmail('item-456', 'Reply')).rejects.toThrow(
        'Item not found or not a Gmail item'
      );
    });

    it('throws when item not found', async () => {
      mockFindInboxItem.mockResolvedValue(null);

      await expect(replyToEmail('nonexistent', 'Reply')).rejects.toThrow(
        'Item not found or not a Gmail item'
      );
    });

    it('throws when threadId is missing', async () => {
      mockFindInboxItem.mockResolvedValue({
        ...mockGmailItem,
        rawPayload: { messageId: 'msg-123', rfc822MessageId: '<msg-123@mail.gmail.com>' },
      });

      await expect(replyToEmail('item-123', 'Reply')).rejects.toThrow(
        'No threadId found for this item'
      );
    });
  });

  describe('getUnsubscribeUrl', () => {
    it('returns unsubscribe URL for Gmail item', async () => {
      const url = await getUnsubscribeUrl('item-123');

      expect(url).toBe('https://example.com/unsubscribe');
    });

    it('returns null for non-Gmail items', async () => {
      mockFindInboxItem.mockResolvedValue(mockNonGmailItem);

      const url = await getUnsubscribeUrl('item-456');

      expect(url).toBeNull();
    });

    it('returns null when item not found', async () => {
      mockFindInboxItem.mockResolvedValue(null);

      const url = await getUnsubscribeUrl('nonexistent');

      expect(url).toBeNull();
    });

    it('returns null when no unsubscribe URL in payload', async () => {
      mockFindInboxItem.mockResolvedValue({
        ...mockGmailItem,
        rawPayload: { messageId: 'msg-123' },
      });

      const url = await getUnsubscribeUrl('item-123');

      expect(url).toBeNull();
    });
  });
});
