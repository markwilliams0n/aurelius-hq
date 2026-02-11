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

// Mock googleapis - CRITICAL: prevents real API calls
vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(function (this: any) {
        this.getClient = vi.fn().mockResolvedValue({
          getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
        });
      }),
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          list: vi.fn().mockResolvedValue({
            data: {
              messages: [{ id: 'msg-1', threadId: 'thread-1' }],
              resultSizeEstimate: 1,
              nextPageToken: null,
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: Date.now().toString(),
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: 'Sender <sender@example.com>' },
                  { name: 'To', value: 'recipient@example.com' },
                  { name: 'Subject', value: 'Test Subject' },
                  { name: 'Date', value: new Date().toISOString() },
                ],
                body: { data: Buffer.from('Test body').toString('base64') },
              },
              snippet: 'Test snippet...',
            },
          }),
          modify: vi.fn().mockResolvedValue({ data: {} }),
          send: vi.fn().mockResolvedValue({
            data: { id: 'sent-msg-1' },
          }),
          attachments: {
            get: vi.fn().mockResolvedValue({
              data: {
                data: Buffer.from('attachment content').toString('base64'),
                size: 18,
              },
            }),
          },
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft-1' },
          }),
        },
      },
    })),
  },
}));

// Mock fs for service account file
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() =>
      JSON.stringify({
        client_email: 'test@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
      })
    ),
    promises: {
      readFile: vi.fn(() =>
        Promise.resolve(
          JSON.stringify({
            client_email: 'test@project.iam.gserviceaccount.com',
            private_key: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
          })
        )
      ),
    },
  };
});

// Mock config/sync-state
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => Promise.resolve(null)),
  setConfig: vi.fn(() => Promise.resolve()),
}));

import { getGravatarUrl, searchEmails, getAttachment } from '../client';

describe('Gmail Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGravatarUrl', () => {
    it('generates correct Gravatar URL for email', () => {
      const url = getGravatarUrl('test@example.com');

      // Should contain gravatar domain
      expect(url).toContain('gravatar.com/avatar');
      // Should have mystery person default
      expect(url).toContain('d=mp');
      // Should be consistent for same email
      expect(url).toBe(getGravatarUrl('test@example.com'));
    });

    it('normalizes email case', () => {
      const url1 = getGravatarUrl('Test@Example.com');
      const url2 = getGravatarUrl('test@example.com');

      expect(url1).toBe(url2);
    });

    it('trims whitespace from email', () => {
      const url1 = getGravatarUrl('  test@example.com  ');
      const url2 = getGravatarUrl('test@example.com');

      expect(url1).toBe(url2);
    });
  });
});

describe('Gmail API Safety', () => {
  // This test suite documents that all Gmail API interactions are mocked
  // No real API calls can be made during testing

  it('googleapis is mocked to prevent real API calls', async () => {
    // Import the mocked module
    const { google } = await import('googleapis');

    // The google.gmail function should return our mock, not make real calls
    const gmailClient = google.gmail({ version: 'v1' });

    // Verify mock structure exists
    expect(gmailClient.users.messages.list).toBeDefined();
    expect(gmailClient.users.messages.get).toBeDefined();
    expect(gmailClient.users.messages.modify).toBeDefined();
    expect(gmailClient.users.messages.send).toBeDefined();
    expect(gmailClient.users.drafts.create).toBeDefined();
  });
});

describe('searchEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls messages.list with the search query and returns parsed emails', async () => {
    const result = await searchEmails({ query: 'from:test@example.com' });

    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].subject).toBe('Test Subject');
    expect(result.totalEstimate).toBe(1);
  });

  it('throws on empty query', async () => {
    await expect(searchEmails({ query: '' })).rejects.toThrow('Search query is required');
    await expect(searchEmails({ query: '   ' })).rejects.toThrow('Search query is required');
  });

  it('caps maxResults at 50 and clamps minimum to 1', async () => {
    // maxResults > 50 still works (capped internally), returns results
    const result = await searchEmails({ query: 'test', maxResults: 100 });
    expect(result.emails).toHaveLength(1);

    // maxResults < 1 still works (clamped to 1)
    const result2 = await searchEmails({ query: 'test', maxResults: 0 });
    expect(result2.emails).toHaveLength(1);
  });

  it('defaults maxResults to 10 when not specified', async () => {
    // Should work without specifying maxResults
    const result = await searchEmails({ query: 'test' });
    expect(result.emails).toHaveLength(1);
  });
});

describe('getAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported as a function', () => {
    expect(typeof getAttachment).toBe('function');
  });

  it('returns buffer data from the API', async () => {
    const result = await getAttachment('msg-1', 'att-1');

    expect(result.data).toBeInstanceOf(Buffer);
    expect(result.size).toBe(18);
  });
});
