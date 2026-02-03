import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment variables
vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PATH', '/mock/path/service-account.json');
vi.stubEnv('GOOGLE_IMPERSONATE_EMAIL', 'mark@rostr.cc');
vi.stubEnv('GMAIL_ENABLE_SEND', 'false');

// Mock googleapis - CRITICAL: prevents real API calls
vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({
        getClient: vi.fn().mockResolvedValue({
          getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
        }),
      })),
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          list: vi.fn().mockResolvedValue({
            data: {
              messages: [{ id: 'msg-1', threadId: 'thread-1' }],
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

import { getGravatarUrl } from '../client';

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
