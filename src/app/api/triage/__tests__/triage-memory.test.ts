import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock data ---
const mockEmailItem = {
  id: 'uuid-email-1',
  connector: 'gmail',
  externalId: 'email-1',
  sender: 'john@acme.io',
  senderName: 'John Doe',
  subject: 'Project Update',
  content: 'Here is the project update...',
  status: 'new',
  priority: 'normal',
  tags: [],
  rawPayload: null,
  enrichment: null,
};

const mockLinearItem = {
  id: 'uuid-linear-1',
  connector: 'linear',
  externalId: 'linear-1',
  sender: 'Mobile App v2',
  senderName: 'Alex',
  subject: '[Bug] Critical issue',
  content: 'Something is broken',
  status: 'new',
  priority: 'urgent',
  tags: [],
  rawPayload: null,
  enrichment: null,
};

// --- DB mock: chainable select ---
let dbSelectResult: unknown[] = [mockEmailItem];

const mockLimit = vi.fn(() => Promise.resolve(dbSelectResult));
const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => mockSelect(),
    update: () => mockUpdate(),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  inboxItems: { externalId: 'externalId' },
  activityLog: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// Mock daily notes
vi.mock('@/lib/memory/daily-notes', () => ({
  appendToDailyNote: vi.fn().mockResolvedValue(undefined),
}));

// Mock Supermemory
vi.mock('@/lib/memory/supermemory', () => ({
  addMemory: vi.fn().mockResolvedValue(undefined),
}));

// Mock Ollama
vi.mock('@/lib/memory/ollama', () => ({
  isOllamaAvailable: vi.fn().mockResolvedValue(false),
  generate: vi.fn().mockResolvedValue(null),
}));

// Mock activity logging
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue({ id: 'activity-1' }),
}));

// Mock memory entities and facts (added after bulk memory merge)
vi.mock('@/lib/memory/entities', () => ({
  upsertEntity: vi.fn().mockResolvedValue({ id: 'entity-1', name: 'Test' }),
}));

vi.mock('@/lib/memory/facts', () => ({
  createFact: vi.fn().mockResolvedValue({ id: 'fact-1' }),
}));

import { POST } from '../[id]/memory/route';
import { appendToDailyNote } from '@/lib/memory/daily-notes';
import { addMemory } from '@/lib/memory/supermemory';
import { logActivity } from '@/lib/activity';

describe('Triage Memory API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectResult = [mockEmailItem];
  });

  describe('POST /api/triage/[id]/memory', () => {
    it('returns success with queued status for email item', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.itemId).toBe('email-1');
      expect(data.status).toBe('queued');
    });

    it('logs activity for memory save', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      await POST(request, { params });

      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'triage_action',
          actor: 'user',
          description: expect.stringContaining('Project Update'),
        })
      );
    });

    it('returns 404 when item not found', async () => {
      dbSelectResult = [];

      const request = new Request('http://localhost/api/triage/non-existent/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'non-existent' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Item not found');
    });

    it('defaults to summary mode', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(data.mode).toBe('summary');
    });

    it('accepts full mode via body', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
        body: JSON.stringify({ mode: 'full' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(data.mode).toBe('full');
    });

    it('returns activity ID for tracking', async () => {
      const request = new Request('http://localhost/api/triage/email-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'email-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(data.activityId).toBe('activity-1');
    });

    it('handles linear items', async () => {
      dbSelectResult = [mockLinearItem];

      const request = new Request('http://localhost/api/triage/linear-1/memory', {
        method: 'POST',
      });
      const params = Promise.resolve({ id: 'linear-1' });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.itemId).toBe('linear-1');
    });
  });
});
