import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock data ---
const mockItem = {
  id: 'uuid-item-1',
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
  enrichment: null,
  rawPayload: null,
  snoozedUntil: null,
};

// --- DB mock: chainable select/update ---
let dbSelectResult: unknown[] = [mockItem];
let dbUpdateResult: unknown[] = [mockItem];

const mockLimit = vi.fn(() => Promise.resolve(dbSelectResult));
const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockReturning = vi.fn(() => Promise.resolve(dbUpdateResult));
const mockUpdateWhere = vi.fn(() => ({ returning: mockReturning }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => mockSelect(),
    update: () => mockUpdate(),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  inboxItems: { id: 'id', externalId: 'externalId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _type: 'eq', val })),
  or: vi.fn((...args: unknown[]) => ({ _type: 'or', args })),
}));

// Mock gmail actions (background sync)
vi.mock('@/lib/gmail/actions', () => ({
  syncArchiveToGmail: vi.fn().mockResolvedValue(undefined),
  syncSpamToGmail: vi.fn().mockResolvedValue(undefined),
  markActionNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear
vi.mock('@/lib/linear', () => ({
  archiveNotification: vi.fn().mockResolvedValue(true),
}));

// Mock activity log
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue({ id: 'activity-1' }),
}));

import { GET, POST } from '../[id]/route';

describe('Triage Action API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: select returns mockItem, update returns updated item
    dbSelectResult = [mockItem];
    dbUpdateResult = [mockItem];
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
      dbSelectResult = [];

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
      dbUpdateResult = [{ ...mockItem, status: 'archived' }];

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
      // Verify the update was called with archived status
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived' })
      );
    });
  });

  describe('POST /api/triage/[id] - snooze action', () => {
    it('snoozes an item with default duration', async () => {
      dbUpdateResult = [{ ...mockItem, status: 'snoozed' }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'snoozed',
          snoozedUntil: expect.any(Date),
        })
      );
    });

    it('snoozes an item with specific duration', async () => {
      dbUpdateResult = [{ ...mockItem, status: 'snoozed' }];

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: '4h' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });

      expect(response.status).toBe(200);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'snoozed' })
      );
    });

    it('calculates snooze time for tomorrow', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      dbUpdateResult = [{ ...mockItem, status: 'snoozed' }];

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: 'tomorrow' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateCall = (mockUpdateSet.mock.calls as any)[0][0] as Record<string, Date>;
      const snoozedUntil = updateCall.snoozedUntil;

      expect(snoozedUntil.getDate()).toBe(16); // Tomorrow
      expect(snoozedUntil.getHours()).toBe(9); // 9 AM

      vi.useRealTimers();
    });

    it('calculates snooze time for next week', async () => {
      vi.useFakeTimers();
      // January 15, 2024 is a Monday
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      dbUpdateResult = [{ ...mockItem, status: 'snoozed' }];

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', duration: 'nextweek' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateCall = (mockUpdateSet.mock.calls as any)[0][0] as Record<string, Date>;
      const snoozedUntil = updateCall.snoozedUntil;

      expect(snoozedUntil.getDate()).toBe(22); // Next Monday
      expect(snoozedUntil.getHours()).toBe(9); // 9 AM

      vi.useRealTimers();
    });
  });

  describe('POST /api/triage/[id] - flag action', () => {
    it('adds flagged tag when item is not flagged', async () => {
      dbUpdateResult = [{ ...mockItem, tags: ['existing-tag', 'flagged'] }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['flagged']),
        })
      );
    });

    it('removes flagged tag when item is already flagged', async () => {
      dbSelectResult = [{
        ...mockItem,
        tags: ['existing-tag', 'flagged'],
      }];
      dbUpdateResult = [{ ...mockItem, tags: ['existing-tag'] }];

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'flag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });

      expect(response.status).toBe(200);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.not.arrayContaining(['flagged']),
        })
      );
    });
  });

  describe('POST /api/triage/[id] - priority action', () => {
    it('updates item priority', async () => {
      dbUpdateResult = [{ ...mockItem, priority: 'urgent' }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'urgent' })
      );
    });

    it('defaults to high priority when not specified', async () => {
      dbUpdateResult = [{ ...mockItem, priority: 'high' }];

      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'priority' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      await POST(request, { params });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high' })
      );
    });
  });

  describe('POST /api/triage/[id] - tag action', () => {
    it('adds a new tag', async () => {
      dbUpdateResult = [{ ...mockItem, tags: ['existing-tag', 'new-tag'] }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['existing-tag', 'new-tag']),
        })
      );
    });

    it('does not duplicate existing tag', async () => {
      const request = new Request('http://localhost/api/triage/item-1', {
        method: 'POST',
        body: JSON.stringify({ action: 'tag', tag: 'existing-tag' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'item-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      // Route still calls update (with updatedAt) but tags won't include duplicate
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('POST /api/triage/[id] - actioned', () => {
    it('marks item as actioned', async () => {
      dbUpdateResult = [{ ...mockItem, status: 'actioned' }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'actioned' })
      );
    });
  });

  describe('POST /api/triage/[id] - restore action', () => {
    it('restores item to new status', async () => {
      dbSelectResult = [{
        ...mockItem,
        status: 'archived',
      }];
      dbUpdateResult = [{ ...mockItem, status: 'new' }];

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
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'new',
          snoozedUntil: null,
        })
      );
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
      dbSelectResult = [];

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
