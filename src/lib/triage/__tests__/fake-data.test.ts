import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateFakeEmails,
  generateFakeSlackMessages,
  generateFakeLinearIssues,
  generateFakeInboxItems,
  getTriageQueue,
} from '../fake-data';
import type { NewInboxItem } from '@/lib/db/schema';

// Mock crypto.randomUUID for consistent tests
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
});

// Mock Ollama as unavailable so enrichment uses regex fallback
vi.mock('@/lib/memory/ollama', () => ({
  isOllamaAvailable: vi.fn().mockResolvedValue(false),
  generate: vi.fn(),
}));

// Mock Supermemory search to return empty results
vi.mock('@/lib/memory/supermemory', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
}));

describe('fake-data', () => {
  describe('generateFakeEmails', () => {
    it('generates the specified number of emails', () => {
      const emails = generateFakeEmails(5);
      expect(emails).toHaveLength(5);
    });

    it('generates default of 10 emails when no count specified', () => {
      const emails = generateFakeEmails();
      expect(emails).toHaveLength(10);
    });

    it('creates valid email items with required fields', () => {
      const emails = generateFakeEmails(1);
      const email = emails[0];

      expect(email.connector).toBe('gmail');
      expect(email.externalId).toMatch(/^email-\d+-\d+$/);
      expect(email.sender).toContain('@');
      expect(email.senderName).toBeTruthy();
      expect(email.subject).toBeTruthy();
      expect(email.content).toBeTruthy();
      expect(email.status).toBe('new');
      expect(['urgent', 'high', 'normal', 'low']).toContain(email.priority);
      expect(Array.isArray(email.tags)).toBe(true);
      expect(email.receivedAt).toBeInstanceOf(Date);
    });

    it('includes enrichment with linked entities', () => {
      const emails = generateFakeEmails(1);
      const email = emails[0];

      expect(email.enrichment).toBeDefined();
      expect(email.enrichment?.linkedEntities).toBeDefined();
      expect(Array.isArray(email.enrichment?.linkedEntities)).toBe(true);
      expect(email.enrichment?.linkedEntities?.length).toBeGreaterThan(0);
    });

    it('generates emails with dates within the last 7 days', () => {
      const emails = generateFakeEmails(10);
      const now = new Date();
      // Add some buffer for test timing
      const sevenDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const futureBuffer = new Date(now.getTime() + 60 * 1000); // 1 minute buffer

      for (const email of emails) {
        const emailDate = email.receivedAt instanceof Date
          ? email.receivedAt
          : new Date(email.receivedAt!);
        expect(emailDate.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo.getTime());
        expect(emailDate.getTime()).toBeLessThanOrEqual(futureBuffer.getTime());
      }
    });
  });

  describe('generateFakeSlackMessages', () => {
    it('generates the specified number of slack messages', () => {
      const messages = generateFakeSlackMessages(3);
      expect(messages).toHaveLength(3);
    });

    it('generates default of 8 messages when no count specified', () => {
      const messages = generateFakeSlackMessages();
      expect(messages).toHaveLength(8);
    });

    it('creates valid slack message items', () => {
      const messages = generateFakeSlackMessages(1);
      const message = messages[0];

      expect(message.connector).toBe('slack');
      expect(message.externalId).toMatch(/^slack-\d+-\d+$/);
      expect(message.sender).toBeTruthy(); // channel
      expect(message.senderName).toBeTruthy(); // user name
      expect(message.subject).toBeTruthy();
      expect(message.content).toBeTruthy();
      expect(message.status).toBe('new');
      expect(message.tags).toContain('slack');
    });

    it('uses slack channels or DMs as sender', () => {
      const messages = generateFakeSlackMessages(20);

      const hasChannel = messages.some(m => m.sender.startsWith('#'));
      const hasDM = messages.some(m => m.sender === '@dm');

      // Should have at least one channel or DM over 20 messages
      expect(hasChannel || hasDM).toBe(true);
    });
  });

  describe('generateFakeLinearIssues', () => {
    it('generates the specified number of linear issues', () => {
      const issues = generateFakeLinearIssues(4);
      expect(issues).toHaveLength(4);
    });

    it('generates default of 6 issues when no count specified', () => {
      const issues = generateFakeLinearIssues();
      expect(issues).toHaveLength(6);
    });

    it('creates valid linear issue items', () => {
      const issues = generateFakeLinearIssues(1);
      const issue = issues[0];

      expect(issue.connector).toBe('linear');
      expect(issue.externalId).toMatch(/^linear-\d+-\d+$/);
      expect(issue.sender).toBeTruthy(); // project name
      expect(issue.senderName).toBeTruthy(); // assignee
      expect(issue.subject).toBeTruthy();
      expect(issue.content).toBeTruthy();
      expect(issue.status).toBe('new');
      expect(issue.tags).toContain('linear');
    });

    it('includes project entity in enrichment', () => {
      const issues = generateFakeLinearIssues(1);
      const issue = issues[0];

      const projectEntity = issue.enrichment?.linkedEntities?.find(
        e => e.type === 'project'
      );
      expect(projectEntity).toBeDefined();
    });
  });

  describe('generateFakeInboxItems', () => {
    it('generates a mix of all connector types', async () => {
      const items = await generateFakeInboxItems();

      const gmailCount = items.filter(i => i.connector === 'gmail').length;
      const slackCount = items.filter(i => i.connector === 'slack').length;
      const linearCount = items.filter(i => i.connector === 'linear').length;

      expect(gmailCount).toBeGreaterThan(0);
      expect(slackCount).toBeGreaterThan(0);
      expect(linearCount).toBeGreaterThan(0);
    });

    it('returns items sorted by priority then date', async () => {
      const items = await generateFakeInboxItems();
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

      for (let i = 0; i < items.length - 1; i++) {
        const currentPriority = items[i].enrichment?.suggestedPriority || items[i].priority;
        const nextPriority = items[i + 1].enrichment?.suggestedPriority || items[i + 1].priority;

        const currentOrder = priorityOrder[currentPriority as keyof typeof priorityOrder];
        const nextOrder = priorityOrder[nextPriority as keyof typeof priorityOrder];

        // If same priority, date should be in descending order
        if (currentOrder === nextOrder) {
          const currentDate = items[i].receivedAt instanceof Date
            ? items[i].receivedAt
            : new Date(items[i].receivedAt!);
          const nextDate = items[i + 1].receivedAt instanceof Date
            ? items[i + 1].receivedAt
            : new Date(items[i + 1].receivedAt!);
          expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
        } else {
          expect(currentOrder).toBeLessThanOrEqual(nextOrder);
        }
      }
    });

    it('applies enrichment to all items', async () => {
      const items = await generateFakeInboxItems();

      for (const item of items) {
        expect(item.enrichment).toBeDefined();
        expect(item.enrichment?.summary).toBeDefined();
        expect(item.enrichment?.suggestedPriority).toBeDefined();
        expect(item.enrichment?.suggestedTags).toBeDefined();
      }
    });
  });

  describe('getTriageQueue', () => {
    let mockItems: NewInboxItem[];

    beforeEach(() => {
      mockItems = [
        {
          connector: 'gmail',
          externalId: 'item-1',
          sender: 'test@example.com',
          subject: 'Test 1',
          content: 'Content 1',
          status: 'new',
          priority: 'low',
          tags: [],
          receivedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          connector: 'gmail',
          externalId: 'item-2',
          sender: 'test@example.com',
          subject: 'Test 2',
          content: 'Content 2',
          status: 'new',
          priority: 'urgent',
          tags: [],
          receivedAt: new Date('2024-01-01T09:00:00Z'),
        },
        {
          connector: 'gmail',
          externalId: 'item-3',
          sender: 'test@example.com',
          subject: 'Test 3',
          content: 'Content 3',
          status: 'archived',
          priority: 'normal',
          tags: [],
          receivedAt: new Date('2024-01-01T11:00:00Z'),
        },
        {
          connector: 'slack',
          externalId: 'item-4',
          sender: '#general',
          subject: 'Test 4',
          content: 'Content 4',
          status: 'new',
          priority: 'normal',
          tags: [],
          receivedAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];
    });

    it('filters to only new items', () => {
      const queue = getTriageQueue(mockItems);
      expect(queue.every(item => item.status === 'new')).toBe(true);
    });

    it('does not include archived items', () => {
      const queue = getTriageQueue(mockItems);
      expect(queue.find(item => item.externalId === 'item-3')).toBeUndefined();
    });

    it('sorts by priority first (urgent > high > normal > low)', () => {
      const queue = getTriageQueue(mockItems);

      // First item should be urgent
      expect(queue[0].priority).toBe('urgent');
    });

    it('sorts by date within same priority (newest first)', () => {
      const items: NewInboxItem[] = [
        {
          connector: 'gmail',
          externalId: 'item-a',
          sender: 'a@test.com',
          subject: 'A',
          content: 'A',
          status: 'new',
          priority: 'normal',
          tags: [],
          receivedAt: new Date('2024-01-01T09:00:00Z'),
        },
        {
          connector: 'gmail',
          externalId: 'item-b',
          sender: 'b@test.com',
          subject: 'B',
          content: 'B',
          status: 'new',
          priority: 'normal',
          tags: [],
          receivedAt: new Date('2024-01-01T11:00:00Z'),
        },
      ];

      const queue = getTriageQueue(items);

      // Item B (newer) should come first
      expect(queue[0].externalId).toBe('item-b');
      expect(queue[1].externalId).toBe('item-a');
    });

    it('returns empty array when no new items', () => {
      const archivedItems: NewInboxItem[] = [
        {
          connector: 'gmail',
          externalId: 'item-1',
          sender: 'test@example.com',
          subject: 'Test',
          content: 'Content',
          status: 'archived',
          priority: 'normal',
          tags: [],
          receivedAt: new Date(),
        },
      ];

      const queue = getTriageQueue(archivedItems);
      expect(queue).toHaveLength(0);
    });
  });
});
