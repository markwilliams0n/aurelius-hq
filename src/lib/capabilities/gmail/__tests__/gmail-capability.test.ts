import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Gmail client
vi.mock('@/lib/gmail/client', () => ({
  isConfigured: vi.fn(() => true),
  searchEmails: vi.fn(),
  getThread: vi.fn(),
  getAttachment: vi.fn(),
  getGravatarUrl: vi.fn(() => 'https://gravatar.com/test'),
}));

// Mock triage insertion
vi.mock('@/lib/triage/insert-with-tasks', () => ({
  insertInboxItemWithTasks: vi.fn(() =>
    Promise.resolve({ id: 'triage-123', status: 'new' })
  ),
}));

// Mock Gmail queries (for draft_email)
vi.mock('@/lib/gmail/queries', () => ({
  findInboxItem: vi.fn(),
}));

import { gmailCapability } from '../index';

describe('Gmail Capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports all expected tools', () => {
    const toolNames = gmailCapability.tools.map(t => t.name);
    expect(toolNames).toContain('search_gmail');
    expect(toolNames).toContain('get_email');
    expect(toolNames).toContain('get_attachment');
    expect(toolNames).toContain('save_email_to_triage');
    expect(toolNames).toContain('draft_email');
  });

  it('has promptVersion 2', () => {
    expect(gmailCapability.promptVersion).toBe(2);
  });

  it('returns null for unknown tool names', async () => {
    const result = await gmailCapability.handleTool('unknown_tool', {});
    expect(result).toBeNull();
  });

  describe('search_gmail', () => {
    it('returns formatted results', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      (searchEmails as any).mockResolvedValue({
        emails: [{
          threadId: 'thread-1',
          messageId: 'msg-1',
          from: { email: 'test@example.com', name: 'Test User' },
          to: [{ email: 'me@example.com' }],
          cc: [],
          bcc: [],
          subject: 'Test Subject',
          body: 'Test body content',
          snippet: 'Test snippet',
          receivedAt: new Date('2025-01-15'),
          labels: ['INBOX'],
          attachments: [],
          hasUnsubscribe: false,
          hasListId: false,
        }],
        totalEstimate: 1,
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'from:test@example.com',
      });

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.result);
      expect(parsed.count).toBe(1);
      expect(parsed.results[0].subject).toBe('Test Subject');
      expect(parsed.results[0].from).toContain('Test User');
    });

    it('truncates long body text to 1500 chars', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      const longBody = 'x'.repeat(3000);
      (searchEmails as any).mockResolvedValue({
        emails: [{
          threadId: 'thread-1',
          messageId: 'msg-1',
          from: { email: 'test@example.com' },
          to: [],
          cc: [],
          bcc: [],
          subject: 'Test',
          body: longBody,
          snippet: 'Test',
          receivedAt: new Date('2025-01-15'),
          labels: [],
          attachments: [],
          hasUnsubscribe: false,
          hasListId: false,
        }],
        totalEstimate: 1,
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'test',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.results[0].body.length).toBe(1500);
      expect(parsed.results[0].bodyTruncated).toBe(true);
      expect(parsed.results[0].fullBodyLength).toBe(3000);
    });

    it('includes attachment metadata in results', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      (searchEmails as any).mockResolvedValue({
        emails: [{
          threadId: 'thread-1',
          messageId: 'msg-1',
          from: { email: 'test@example.com' },
          to: [],
          cc: [],
          bcc: [],
          subject: 'With attachment',
          body: 'See attached',
          snippet: 'See attached',
          receivedAt: new Date('2025-01-15'),
          labels: [],
          attachments: [{
            id: 'att-1',
            filename: 'report.csv',
            mimeType: 'text/csv',
            size: 1024,
          }],
          hasUnsubscribe: false,
          hasListId: false,
        }],
        totalEstimate: 1,
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'has:attachment',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.results[0].attachments).toHaveLength(1);
      expect(parsed.results[0].attachments[0].filename).toBe('report.csv');
    });

    it('returns error on empty query', async () => {
      const result = await gmailCapability.handleTool('search_gmail', { query: '' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('required');
    });

    it('returns error when not configured', async () => {
      const { isConfigured } = await import('@/lib/gmail/client');
      (isConfigured as any).mockReturnValueOnce(false);

      const result = await gmailCapability.handleTool('search_gmail', { query: 'test' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not configured');
    });

    it('handles empty search results', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      (searchEmails as any).mockResolvedValue({
        emails: [],
        totalEstimate: 0,
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'nonexistent',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.count).toBe(0);
      expect(parsed.message).toContain('No emails found');
    });

    it('handles auth errors gracefully', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      (searchEmails as any).mockRejectedValue({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'test',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('authentication failed');
    });

    it('handles rate limit errors gracefully', async () => {
      const { searchEmails } = await import('@/lib/gmail/client');
      (searchEmails as any).mockRejectedValue({
        response: { status: 429 },
        message: 'Rate limited',
      });

      const result = await gmailCapability.handleTool('search_gmail', {
        query: 'test',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('rate limit');
    });
  });

  describe('get_email', () => {
    it('returns full thread content', async () => {
      const { getThread } = await import('@/lib/gmail/client');
      (getThread as any).mockResolvedValue([{
        messageId: 'msg-1',
        from: { email: 'test@example.com', name: 'Test' },
        to: [{ email: 'me@example.com' }],
        cc: [],
        subject: 'Test',
        body: 'Full body text here',
        receivedAt: new Date('2025-01-15'),
        attachments: [],
      }]);

      const result = await gmailCapability.handleTool('get_email', {
        thread_id: 'thread-1',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.messageCount).toBe(1);
      expect(parsed.messages[0].body).toContain('Full body text');
    });

    it('truncates body to 3000 chars', async () => {
      const { getThread } = await import('@/lib/gmail/client');
      const longBody = 'y'.repeat(5000);
      (getThread as any).mockResolvedValue([{
        messageId: 'msg-1',
        from: { email: 'test@example.com' },
        to: [],
        cc: [],
        subject: 'Test',
        body: longBody,
        receivedAt: new Date('2025-01-15'),
        attachments: [],
      }]);

      const result = await gmailCapability.handleTool('get_email', {
        thread_id: 'thread-1',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.messages[0].body.length).toBe(3000);
      expect(parsed.messages[0].bodyTruncated).toBe(true);
    });

    it('returns error on empty thread_id', async () => {
      const result = await gmailCapability.handleTool('get_email', { thread_id: '' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('required');
    });

    it('returns error when not configured', async () => {
      const { isConfigured } = await import('@/lib/gmail/client');
      (isConfigured as any).mockReturnValueOnce(false);

      const result = await gmailCapability.handleTool('get_email', { thread_id: 'thread-1' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not configured');
    });

    it('handles 404 errors', async () => {
      const { getThread } = await import('@/lib/gmail/client');
      (getThread as any).mockRejectedValue({
        response: { status: 404 },
        message: 'Not found',
      });

      const result = await gmailCapability.handleTool('get_email', {
        thread_id: 'deleted-thread',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not found');
    });
  });

  describe('save_email_to_triage', () => {
    it('imports email and returns triage item ID', async () => {
      const { getThread } = await import('@/lib/gmail/client');
      (getThread as any).mockResolvedValue([{
        messageId: 'msg-1',
        threadId: 'thread-1',
        from: { email: 'test@example.com', name: 'Test' },
        to: [{ email: 'me@example.com' }],
        cc: [],
        bcc: [],
        subject: 'Test Import',
        body: 'Body text',
        snippet: 'Snippet',
        receivedAt: new Date('2025-01-15'),
        labels: ['INBOX'],
        attachments: [],
        hasUnsubscribe: false,
        hasListId: false,
        rfc822MessageId: '<msg@example.com>',
        bodyHtml: '<p>Body</p>',
        unsubscribeUrl: undefined,
      }]);

      const result = await gmailCapability.handleTool('save_email_to_triage', {
        thread_id: 'thread-1',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.itemId).toBe('triage-123');
      expect(parsed.summary).toContain('Test Import');
    });

    it('returns error on empty thread_id', async () => {
      const result = await gmailCapability.handleTool('save_email_to_triage', { thread_id: '' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('required');
    });

    it('returns error when not configured', async () => {
      const { isConfigured } = await import('@/lib/gmail/client');
      (isConfigured as any).mockReturnValueOnce(false);

      const result = await gmailCapability.handleTool('save_email_to_triage', { thread_id: 'thread-1' });
      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not configured');
    });
  });

  describe('get_attachment', () => {
    it('returns text content for text files', async () => {
      const { getAttachment } = await import('@/lib/gmail/client');
      (getAttachment as any).mockResolvedValue({
        data: Buffer.from('name,email\nJohn,john@test.com'),
        size: 28,
      });

      const result = await gmailCapability.handleTool('get_attachment', {
        message_id: 'msg-1',
        attachment_id: 'att-1',
        filename: 'contacts.csv',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.filename).toBe('contacts.csv');
      expect(parsed.content).toContain('name,email');
      expect(parsed.size).toBe(28);
    });

    it('returns null content for binary files', async () => {
      const { getAttachment } = await import('@/lib/gmail/client');
      (getAttachment as any).mockResolvedValue({
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        size: 4,
      });

      const result = await gmailCapability.handleTool('get_attachment', {
        message_id: 'msg-1',
        attachment_id: 'att-1',
        filename: 'image.png',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.content).toBeNull();
      expect(parsed.reason).toContain('Binary file');
    });

    it('returns error when missing required params', async () => {
      const result = await gmailCapability.handleTool('get_attachment', {
        message_id: '',
        attachment_id: '',
        filename: 'test.txt',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('required');
    });

    it('returns error when not configured', async () => {
      const { isConfigured } = await import('@/lib/gmail/client');
      (isConfigured as any).mockReturnValueOnce(false);

      const result = await gmailCapability.handleTool('get_attachment', {
        message_id: 'msg-1',
        attachment_id: 'att-1',
        filename: 'test.txt',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not configured');
    });
  });

  describe('draft_email', () => {
    it('returns action card for valid draft', async () => {
      const { findInboxItem } = await import('@/lib/gmail/queries');
      (findInboxItem as any).mockResolvedValue({
        id: 'item-1',
        connector: 'gmail',
        sender: 'sender@example.com',
        senderName: 'Sender',
        subject: 'Original Subject',
      });

      const result = await gmailCapability.handleTool('draft_email', {
        item_id: 'item-1',
        body: 'Thanks for your email.',
      });

      expect(result).not.toBeNull();
      expect(result!.actionCard).toBeDefined();
      expect(result!.actionCard!.handler).toBe('gmail:send-email');
      expect(result!.actionCard!.data.subject).toBe('Re: Original Subject');
    });

    it('returns error when item not found', async () => {
      const { findInboxItem } = await import('@/lib/gmail/queries');
      (findInboxItem as any).mockResolvedValue(null);

      const result = await gmailCapability.handleTool('draft_email', {
        item_id: 'nonexistent',
        body: 'Reply text',
      });

      const parsed = JSON.parse(result!.result);
      expect(parsed.error).toContain('not found');
    });
  });
});
