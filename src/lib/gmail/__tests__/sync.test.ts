import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env values
const originalEnv = { ...process.env };

// Mock parsed email data
const mockParsedEmail = {
  messageId: 'msg-123',
  threadId: 'thread-123',
  from: { email: 'sender@example.com', name: 'Test Sender' },
  to: [{ email: 'mark@rostr.cc', name: 'Mark' }],
  cc: [],
  bcc: [],
  subject: 'Test Email Subject',
  snippet: 'This is a test email snippet...',
  body: 'Full body content of the test email.',
  receivedAt: new Date('2024-01-15T10:00:00Z'),
  labels: ['INBOX'],
  attachments: [],
  hasUnsubscribe: false,
  hasListId: false,
  unsubscribeUrl: undefined,
};

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

// Mock the database
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'new-item-id' }])),
      })),
    })),
  },
}));

vi.mock('@/lib/db/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/schema')>();
  return {
    ...actual,
    inboxItems: {
      id: 'id',
      connector: 'connector',
      externalId: 'externalId',
    },
  };
});

// Mock the triage insert function
vi.mock('@/lib/triage/insert-with-tasks', () => ({
  insertInboxItemWithTasks: vi.fn(() => Promise.resolve({ id: 'new-item-id' })),
}));

// Mock the AI client to avoid needing API keys in tests
vi.mock('@/lib/ai/client', () => ({
  chat: vi.fn(() => Promise.resolve('This is a test summary.')),
}));

// Mock the Gmail client
vi.mock('../client', () => ({
  isConfigured: vi.fn(() => true),
  fetchUnarchived: vi.fn(() =>
    Promise.resolve({
      emails: [mockParsedEmail],
      nextPageToken: undefined,
    })
  ),
  getSyncState: vi.fn(() => Promise.resolve(null)),
  saveSyncState: vi.fn(() => Promise.resolve()),
  getGravatarUrl: vi.fn(
    (email: string) =>
      `https://www.gravatar.com/avatar/${email}?d=identicon`
  ),
}));

import { syncGmailMessages } from '../sync';
import { isConfigured, fetchUnarchived } from '../client';
import { insertInboxItemWithTasks } from '@/lib/triage/insert-with-tasks';
import { db } from '@/lib/db';

// Helper to reset db mock to "thread doesn't exist" state
const resetDbMockToEmpty = () => {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as any);
};

describe('Gmail Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockToEmpty();
  });

  describe('syncGmailMessages', () => {
    it('skips sync when Gmail is not configured', async () => {
      vi.mocked(isConfigured).mockReturnValue(false);

      const result = await syncGmailMessages();

      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(fetchUnarchived).not.toHaveBeenCalled();
    });

    it('syncs new emails when Gmail is configured', async () => {
      vi.mocked(isConfigured).mockReturnValue(true);

      const result = await syncGmailMessages();

      expect(result.synced).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].threadId).toBe('thread-123');
      expect(insertInboxItemWithTasks).toHaveBeenCalled();
    });

    it('skips already imported threads', async () => {
      vi.mocked(isConfigured).mockReturnValue(true);

      // Mock that thread already exists in DB
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'existing-item' }]),
          }),
        }),
      } as any);

      const result = await syncGmailMessages();

      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(1);
      expect(insertInboxItemWithTasks).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      vi.mocked(isConfigured).mockReturnValue(true);
      vi.mocked(insertInboxItemWithTasks).mockRejectedValueOnce(
        new Error('DB error')
      );

      const result = await syncGmailMessages();

      expect(result.errors).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('deduplicates by thread - only processes latest message', async () => {
      vi.mocked(isConfigured).mockReturnValue(true);

      // Two messages in same thread
      const olderMessage = {
        ...mockParsedEmail,
        messageId: 'msg-older',
        receivedAt: new Date('2024-01-14T10:00:00Z'),
      };
      const newerMessage = {
        ...mockParsedEmail,
        messageId: 'msg-newer',
        receivedAt: new Date('2024-01-16T10:00:00Z'),
      };

      vi.mocked(fetchUnarchived).mockResolvedValueOnce({
        emails: [olderMessage, newerMessage],
        nextPageToken: undefined,
      });

      const result = await syncGmailMessages();

      // Should only sync one item (the latest message per thread)
      expect(result.synced).toBe(1);
      expect(result.emails[0].id).toBe('msg-newer');
    });
  });
});

describe('Smart Sender Analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockToEmpty();
    vi.mocked(isConfigured).mockReturnValue(true);
  });

  // These would test the analyzeSender function if exported
  // For now, verify the sync creates items with expected sender tags

  it('tags internal emails correctly', async () => {

    const internalEmail = {
      ...mockParsedEmail,
      from: { email: 'coworker@rostr.cc', name: 'Coworker' },
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [internalEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    // Verify insertInboxItemWithTasks was called with enrichment containing 'Internal' tag
    expect(insertInboxItemWithTasks).toHaveBeenCalled();
    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('Internal');
  });

  it('tags direct emails correctly', async () => {
    const directEmail = {
      ...mockParsedEmail,
      to: [{ email: 'mark@rostr.cc', name: 'Mark' }],
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [directEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('Direct');
  });

  it('tags CC emails correctly', async () => {
    const ccEmail = {
      ...mockParsedEmail,
      to: [{ email: 'someone@example.com', name: 'Someone' }],
      cc: [{ email: 'mark@rostr.cc', name: 'Mark' }],
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [ccEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('CC');
  });

  it('tags automated emails correctly', async () => {
    const autoEmail = {
      ...mockParsedEmail,
      from: { email: 'noreply@example.com', name: 'No Reply' },
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [autoEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('Auto');
  });

  it('tags newsletters correctly', async () => {
    const newsletterEmail = {
      ...mockParsedEmail,
      hasUnsubscribe: true,
      unsubscribeUrl: 'https://example.com/unsubscribe',
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [newsletterEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('Newsletter');
  });

  it('tags group emails correctly', async () => {
    const groupEmail = {
      ...mockParsedEmail,
      to: [
        { email: 'a@example.com' },
        { email: 'b@example.com' },
        { email: 'c@example.com' },
      ],
      cc: [{ email: 'd@example.com' }, { email: 'e@example.com' }],
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [groupEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.senderTags).toContain('Group');
  });
});

describe('Phishing Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockToEmpty();
    vi.mocked(isConfigured).mockReturnValue(true);
  });

  it('detects brand impersonation in display name', async () => {
    const phishingEmail = {
      ...mockParsedEmail,
      from: { email: 'support@fakebrand.com', name: 'Stripe Support' },
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [phishingEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.isSuspicious).toBe(true);
    expect(callArg.enrichment?.senderTags).toContain('Suspicious');
  });

  it('detects urgency patterns in subject', async () => {
    const urgentPhishing = {
      ...mockParsedEmail,
      subject: 'Your account has been suspended - verify immediately',
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [urgentPhishing],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.isSuspicious).toBe(true);
  });

  it('does not flag legitimate emails', async () => {
    const legitimateEmail = {
      ...mockParsedEmail,
      from: { email: 'support@stripe.com', name: 'Stripe Support' },
      subject: 'Your payment receipt',
    };

    vi.mocked(fetchUnarchived).mockResolvedValueOnce({
      emails: [legitimateEmail],
      nextPageToken: undefined,
    });

    await syncGmailMessages();

    const callArg = vi.mocked(insertInboxItemWithTasks).mock.calls[0][0];
    expect(callArg.enrichment?.isSuspicious).toBe(false);
    expect(callArg.enrichment?.senderTags).not.toContain('Suspicious');
  });
});
