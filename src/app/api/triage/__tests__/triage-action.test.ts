import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the parent route module
const mockGetInboxItems = vi.fn();
const mockUpdateInboxItem = vi.fn();

vi.mock('../route', () => ({
  getInboxItems: () => mockGetInboxItems(),
  updateInboxItem: (id: string, updates: any) => mockUpdateInboxItem(id, updates),
}));

// Import after mocking
import { GET, POST } from '../[id]/route';

describe('Triage Action API Routes', () => {
  const mockItem = {
    connector: 'gmail',
    externalId: 'item-1',
    sender: 'test@example.com',
    senderName: 'Test User',
    subject: 'Test Subject',
    content: 'Test content',
    status: 'new',
    priority: 'normal',
    tags: ['existing-tag'],
    receivedAt: new Date('2024-01-15T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInboxItems.mockReturnValue([mockItem]);
    mockUpdateInboxItem.mockImplementation((id, updates) => ({
      ...mockItem,
      ...updates,
    }));
  });

  describe('GET /api/triage/[id]', () => {
    it('returns the item when found', async () => {
      const request = new Request('http://localhost/api/triage/item-1');
      const params = Promise.resolve({ id: 'item-1' });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.item).toBeDefined();
      expect(data.item.externalId).toBe('item-1');
    });

    it('returns 404 when item not found', async () => {
      const request = new Request('http://localhost/api/triage/non-existent');
      const params = Promise.resolve({ id: 'non-existent' });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Item not found');
    });
  });

  describe('POST /api/triage/[id] - archive action', () => {
    it('archives an item', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'archive' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.action).toBe('archive');
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: 'archived',
      }));
    });
  });

  describe('POST /api/triage/[id] - snooze action', () => {
    it('snoozes an item with default duration', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.action).toBe('snooze');
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: 'snoozed',
        snoozedUntil: expect.any(Date),
      }));
    });

    it('snoozes an item with specific duration', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: '4h' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });

      expect(response.status).toBe(200);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: 'snoozed',
      }));
    });

    it('calculates snooze time for tomorrow', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: 'tomorrow' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      const updateCall = mockUpdateInboxItem.mock.calls[0];
      const snoozedUntil = updateCall[1].snoozedUntil;

      expect(snoozedUntil.getDate()).toBe(16); // Tomorrow
      expect(snoozedUntil.getHours()).toBe(9); // 9 AM

      vi.useRealTimers();
    });

    it('calculates snooze time for next week', async () => {
      vi.useFakeTimers();
      // January 15, 2024 is a Monday
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: 'nextweek' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      const updateCall = mockUpdateInboxItem.mock.calls[0];
      const snoozedUntil = updateCall[1].snoozedUntil;

      expect(snoozedUntil.getDate()).toBe(22); // Next Monday
      expect(snoozedUntil.getHours()).toBe(9); // 9 AM

      vi.useRealTimers();
    });
  });

  describe('POST /api/triage/[id] - flag action', () => {
    it('adds flagged tag when item is not flagged', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'flag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        tags: expect.arrayContaining(['flagged']),
      }));
    });

    it('removes flagged tag when item is already flagged', async () => {
      mockGetInboxItems.mockReturnValue([{
        ...mockItem,
        tags: ['existing-tag', 'flagged'],
      }]);

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'flag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });

      expect(response.status).toBe(200);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        tags: expect.not.arrayContaining(['flagged']),
      }));
    });
  });

  describe('POST /api/triage/[id] - priority action', () => {
    it('updates item priority', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'priority', priority: 'urgent' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        priority: 'urgent',
      }));
    });

    it('defaults to high priority when not specified', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'priority' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        priority: 'high',
      }));
    });
  });

  describe('POST /api/triage/[id] - tag action', () => {
    it('adds a new tag', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'tag', tag: 'new-tag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        tags: expect.arrayContaining(['existing-tag', 'new-tag']),
      }));
    });

    it('does not duplicate existing tag', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'tag', tag: 'existing-tag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      // Should not call updateInboxItem with duplicate tag
      expect(mockUpdateInboxItem).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/triage/[id] - actioned', () => {
    it('marks item as actioned', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'actioned' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: 'actioned',
      }));
    });
  });

  describe('POST /api/triage/[id] - restore action', () => {
    it('restores item to new status', async () => {
      mockGetInboxItems.mockReturnValue([{
        ...mockItem,
        status: 'archived',
      }]);

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'restore' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateInboxItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: 'new',
        snoozedUntil: undefined,
      }));
    });
  });

  describe('POST /api/triage/[id] - unknown action', () => {
    it('returns 400 for unknown action', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'unknown-action' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Unknown action: unknown-action');
    });
  });

  describe('POST /api/triage/[id] - item not found', () => {
    it('returns 404 when item does not exist', async () => {
      const request = new Request('http://localhost/api/triage/non-existent', {
        method: 'POST',
        body: JSON.stringify({ action: 'archive' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'non-existent' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Item not found');
    });
  });
});
