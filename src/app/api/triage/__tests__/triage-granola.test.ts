import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInboxItems } = vi.hoisted(() => ({
  mockInboxItems: [
    {
      id: 1,
      connector: 'gmail',
      externalId: 'email-1',
      sender: 'test@example.com',
      senderName: 'Test User',
      subject: 'Test Email',
      preview: 'Preview...',
      content: 'Content',
      rawPayload: {},
      receivedAt: new Date('2024-01-15T10:00:00Z'),
      status: 'new',
      priority: 'normal',
      tags: [],
      aiEnrichment: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      connector: 'granola',
      externalId: 'granola-meeting-123',
      sender: 'organizer@example.com',
      senderName: 'Engineering Weekly',
      subject: 'Engineering Weekly',
      preview: 'Discussed roadmap priorities...',
      content: '# Meeting Notes\n\nDiscussed roadmap priorities.',
      rawPayload: { notes: '# Meeting Notes', attendees: [] },
      receivedAt: new Date('2024-01-15T11:00:00Z'),
      status: 'new',
      priority: 'normal',
      tags: [],
      aiEnrichment: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
}));

// Mock database - create a chainable mock that returns mockInboxItems
vi.mock('@/lib/db', () => {
  const createChainMock = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (items: any[]) => void) => resolve(mockInboxItems),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => createChainMock()),
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  inboxItems: {
    status: 'status',
    connector: 'connector',
    priority: 'priority',
    receivedAt: 'receivedAt',
  },
}));

// Import after mocking
import { getInboxItemsFromDb } from '../route';

describe('Triage API - Database Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches inbox items from database including granola items', async () => {
    const items = await getInboxItemsFromDb();

    expect(items).toBeDefined();
    expect(Array.isArray(items)).toBe(true);

    // Should include granola items
    const granolaItems = items.filter((item: any) => item.connector === 'granola');
    expect(granolaItems.length).toBeGreaterThanOrEqual(1);
  });

  it('returns granola items with correct structure', async () => {
    const items = await getInboxItemsFromDb();

    const granolaItem = items.find((item: any) => item.connector === 'granola');
    expect(granolaItem).toBeDefined();
    expect(granolaItem.subject).toBe('Engineering Weekly');
    expect(granolaItem.externalId).toBe('granola-meeting-123');
  });
});
