import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../route', () => ({
  getInboxItemsFromDb: vi.fn(),
}));

vi.mock('@/lib/memory/entities', () => ({
  upsertEntity: vi.fn(),
}));

vi.mock('@/lib/memory/facts', () => ({
  createFact: vi.fn(),
}));

vi.mock('@/lib/memory/daily-notes', () => ({
  appendToDailyNote: vi.fn(),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
});

// Import after mocking
import { POST } from '../[id]/memory/route';
import { getInboxItemsFromDb } from '../route';
import { upsertEntity } from '@/lib/memory/entities';
import { createFact } from '@/lib/memory/facts';
import { appendToDailyNote } from '@/lib/memory/daily-notes';

describe('Triage Memory API Route', () => {
  const mockEmailItem = {
    connector: 'gmail',
    externalId: 'email-1',
    sender: 'john@acme.io',
    senderName: 'John Doe',
    subject: 'Project Update',
    content: 'Here is the project update...',
    status: 'new',
    priority: 'normal',
    tags: [],
  } as any;

  const mockSlackItem = {
    connector: 'slack',
    externalId: 'slack-1',
    sender: '#engineering',
    senderName: 'Jane Smith',
    subject: 'Build notification',
    content: 'Build passed',
    status: 'new',
    priority: 'normal',
    tags: [],
  } as any;

  const mockLinearItem = {
    connector: 'linear',
    externalId: 'linear-1',
    sender: 'Mobile App v2',
    senderName: 'Alex',
    subject: '[Bug] Critical issue',
    content: 'Something is broken',
    status: 'new',
    priority: 'urgent',
    tags: [],
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInboxItemsFromDb).mockResolvedValue([mockEmailItem, mockSlackItem, mockLinearItem]);
    vi.mocked(upsertEntity).mockResolvedValue({
      id: 'entity-1',
      name: 'Test Entity',
      type: 'person',
      metadata: {},
      summary: null,
      summaryEmbedding: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(createFact).mockResolvedValue({
      id: 'fact-1',
      entityId: 'entity-1',
      content: 'Test fact',
      embedding: null,
      category: 'context',
      status: 'active',
      supersededBy: null,
      sourceType: 'chat',
      sourceId: 'test-1',
      createdAt: new Date(),
    });
    vi.mocked(appendToDailyNote).mockResolvedValue();
  });

  describe('POST /api/triage/[id]/memory', () => {
    it('extracts memory from email item', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.itemId).toBe('email-1');
      expect(Array.isArray(data.facts)).toBe(true);
    });

    it('creates entity for email sender', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      await POST(request, { params });

      expect(upsertEntity).toHaveBeenCalledWith(
        'John Doe',
        'person',
        expect.objectContaining({
          email: 'john@acme.io',
          connector: 'gmail',
        })
      );
    });

    it('extracts company from email domain', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      await POST(request, { params });

      // Should create company entity for acme.io domain
      expect(upsertEntity).toHaveBeenCalledWith(
        'Acme',
        'company',
        expect.objectContaining({
          domain: 'acme.io',
        })
      );
    });

    it('does not extract company from personal email domains', async () => {
      vi.mocked(getInboxItemsFromDb).mockResolvedValue([{
        ...mockEmailItem,
        externalId: 'personal-email',
        sender: 'john@gmail.com',
      }]);

      const request = new Request('http://localhost/api/triage/personal-email/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'personal-email' });

      await POST(request, { params });

      // Should not create company entity for gmail.com
      const companyCalls = vi.mocked(upsertEntity).mock.calls.filter(
        call => call[1] === 'company'
      );
      expect(companyCalls).toHaveLength(0);
    });

    it('creates fact for sender contact', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      await POST(request, { params });

      expect(createFact).toHaveBeenCalledWith(
        'entity-1',
        expect.stringContaining('John Doe contacted us about'),
        'context',
        'chat',
        'email-1'
      );
    });

    it('creates priority status fact for urgent items', async () => {
      vi.mocked(getInboxItemsFromDb).mockResolvedValue([mockLinearItem]);

      const request = new Request('http://localhost/api/triage/linear-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'linear-1' });

      await POST(request, { params });

      expect(createFact).toHaveBeenCalledWith(
        'entity-1',
        expect.stringContaining('High priority'),
        'status',
        'chat',
        'linear-1'
      );
    });

    it('extracts project entity from Linear items', async () => {
      vi.mocked(getInboxItemsFromDb).mockResolvedValue([mockLinearItem]);

      const request = new Request('http://localhost/api/triage/linear-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'linear-1' });

      await POST(request, { params });

      expect(upsertEntity).toHaveBeenCalledWith(
        'Mobile App v2',
        'project',
        expect.objectContaining({
          source: 'linear',
        })
      );
    });

    it('appends to daily notes', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      await POST(request, { params });

      expect(appendToDailyNote).toHaveBeenCalledWith(
        expect.stringContaining('Triage: Project Update')
      );
    });

    it('returns 404 when item not found', async () => {
      const request = new Request('http://localhost/api/triage/non-existent/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'non-existent' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Item not found');
    });

    it('falls back gracefully when database fails', async () => {
      vi.mocked(upsertEntity).mockRejectedValue(new Error('Database error'));

      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      // Should still return a successful response even with database failures
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.facts)).toBe(true);
    });
  });

  describe('fallback behavior', () => {
    beforeEach(() => {
      // Reset mocks - set up for fallback mode where database ops fail
      vi.mocked(getInboxItemsFromDb).mockResolvedValue([mockEmailItem, mockSlackItem, mockLinearItem]);
      vi.mocked(upsertEntity).mockRejectedValue(new Error('Database error'));
    });

    it('returns facts even when database operations fail', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      // Should still return success with facts (either real or simulated)
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.facts)).toBe(true);
    });

    it('handles database failure gracefully', async () => {
      vi.mocked(getInboxItemsFromDb).mockResolvedValue([mockLinearItem]);

      const request = new Request('http://localhost/api/triage/linear-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'linear-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
