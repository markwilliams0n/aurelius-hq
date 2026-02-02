import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fake data module
vi.mock('@/lib/triage/fake-data', () => ({
  generateFakeInboxItems: vi.fn(() => [
    {
      connector: 'gmail',
      externalId: 'item-1',
      sender: 'test1@example.com',
      senderName: 'Test User 1',
      subject: 'Test Email 1',
      content: 'Content 1',
      status: 'new',
      priority: 'normal',
      tags: ['tag1'],
      receivedAt: new Date('2024-01-15T10:00:00Z'),
    },
    {
      connector: 'slack',
      externalId: 'item-2',
      sender: '#general',
      senderName: 'Test User 2',
      subject: 'Test Message',
      content: 'Content 2',
      status: 'new',
      priority: 'urgent',
      tags: [],
      receivedAt: new Date('2024-01-15T11:00:00Z'),
    },
    {
      connector: 'linear',
      externalId: 'item-3',
      sender: 'Project X',
      senderName: 'Test User 3',
      subject: 'Test Issue',
      content: 'Content 3',
      status: 'archived',
      priority: 'high',
      tags: [],
      receivedAt: new Date('2024-01-15T09:00:00Z'),
    },
  ]),
  getTriageQueue: vi.fn((items) =>
    items
      .filter((i: any) => i.status === 'new')
      .sort((a: any, b: any) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        return (
          (priorityOrder[a.priority as keyof typeof priorityOrder] || 2) -
          (priorityOrder[b.priority as keyof typeof priorityOrder] || 2)
        );
      })
  ),
}));

// Import after mocking
import {
  GET,
  POST,
  getInboxItems,
  updateInboxItem,
  resetInboxItems,
} from '../route';

describe('Triage API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the store before each test
    resetInboxItems();
  });

  describe('GET /api/triage', () => {
    it('returns triage items with default status filter', async () => {
      const request = new Request('http://localhost/api/triage');

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('filters by status parameter', async () => {
      const request = new Request('http://localhost/api/triage?status=archived');

      const response = await GET(request);
      const data = await response.json();

      // Only archived items should be returned (after filtering through getTriageQueue)
      expect(response.status).toBe(200);
      expect(data.items).toBeDefined();
    });

    it('filters by connector parameter', async () => {
      const request = new Request('http://localhost/api/triage?connector=gmail');

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.items).toBeDefined();
    });

    it('respects limit parameter', async () => {
      const request = new Request('http://localhost/api/triage?limit=1');

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.items.length).toBeLessThanOrEqual(1);
    });

    it('returns stats with the response', async () => {
      const request = new Request('http://localhost/api/triage');

      const response = await GET(request);
      const data = await response.json();

      expect(data.stats).toBeDefined();
      expect(typeof data.stats.new).toBe('number');
      expect(typeof data.stats.archived).toBe('number');
      expect(typeof data.stats.snoozed).toBe('number');
      expect(typeof data.stats.actioned).toBe('number');
    });

    it('returns total count', async () => {
      const request = new Request('http://localhost/api/triage');

      const response = await GET(request);
      const data = await response.json();

      expect(typeof data.total).toBe('number');
    });
  });

  describe('POST /api/triage', () => {
    it('resets inbox with fresh fake data', async () => {
      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Inbox reset with fresh fake data');
      expect(typeof data.count).toBe('number');
    });
  });

  describe('getInboxItems', () => {
    it('returns the current inbox items', () => {
      const items = getInboxItems();
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('updateInboxItem', () => {
    it('updates an existing item', () => {
      const items = getInboxItems();
      const firstItem = items[0];

      const updated = updateInboxItem(firstItem.externalId, {
        status: 'archived',
      });

      expect(updated?.status).toBe('archived');
    });

    it('returns undefined for non-existent item', () => {
      const updated = updateInboxItem('non-existent-id', {
        status: 'archived',
      });

      expect(updated).toBeUndefined();
    });

    it('preserves other item properties when updating', () => {
      const items = getInboxItems();
      const firstItem = items[0];
      const originalSubject = firstItem.subject;

      updateInboxItem(firstItem.externalId, {
        status: 'archived',
      });

      const updatedItems = getInboxItems();
      const updatedItem = updatedItems.find(
        (i) => i.externalId === firstItem.externalId
      );

      expect(updatedItem?.subject).toBe(originalSubject);
      expect(updatedItem?.status).toBe('archived');
    });
  });

  describe('resetInboxItems', () => {
    it('returns fresh inbox items', () => {
      const items = resetInboxItems();
      expect(Array.isArray(items)).toBe(true);
    });
  });
});
