import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TriageCard, type TriageItem } from '../triage-card';

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | boolean)[]) =>
    classes.filter(Boolean).join(' '),
}));

describe('TriageCard', () => {
  const mockItem: TriageItem = {
    id: 'test-id-1',
    externalId: 'ext-1',
    connector: 'gmail',
    sender: 'john@acme.io',
    senderName: 'John Doe',
    senderAvatar: null,
    subject: 'Test Subject Line',
    content: 'This is the test content of the email message.',
    preview: 'This is a preview...',
    status: 'new',
    priority: 'normal',
    tags: ['important', 'work'],
    receivedAt: new Date().toISOString(),
    enrichment: {
      summary: 'Test summary',
      suggestedPriority: 'normal',
      suggestedTags: ['suggested'],
      linkedEntities: [
        { id: '1', name: 'John Doe', type: 'person' },
        { id: '2', name: 'Acme', type: 'company' },
      ],
      suggestedActions: [],
      contextFromMemory: 'Previous conversation context',
    },
  };

  describe('rendering', () => {
    it('renders the card without crashing', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Test Subject Line');
    });

    it('displays the sender name', () => {
      render(<TriageCard item={mockItem} />);
      // The sender name appears in the sender info section with font-medium class
      const senderElements = screen.getAllByText('John Doe');
      expect(senderElements.length).toBeGreaterThanOrEqual(1);
    });

    it('displays the sender email when different from name', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('john@acme.io')).toBeInTheDocument();
    });

    it('uses sender as name when senderName is not provided', () => {
      const itemWithoutName: TriageItem = {
        ...mockItem,
        senderName: null,
      };
      render(<TriageCard item={itemWithoutName} />);
      const senderElements = screen.getAllByText('john@acme.io');
      expect(senderElements.length).toBeGreaterThanOrEqual(1);
    });

    it('displays preview when available', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('This is a preview...')).toBeInTheDocument();
    });

    it('displays content when preview is not available', () => {
      const itemWithoutPreview: TriageItem = {
        ...mockItem,
        preview: null,
      };
      render(<TriageCard item={itemWithoutPreview} />);
      expect(screen.getByText(/This is the test content/)).toBeInTheDocument();
    });
  });

  describe('priority badge', () => {
    it('displays urgent priority badge', () => {
      const urgentItem: TriageItem = { ...mockItem, priority: 'urgent' };
      render(<TriageCard item={urgentItem} />);
      expect(screen.getByText('Urgent')).toBeInTheDocument();
    });

    it('displays high priority badge', () => {
      const highItem: TriageItem = { ...mockItem, priority: 'high' };
      render(<TriageCard item={highItem} />);
      expect(screen.getByText('High priority')).toBeInTheDocument();
    });

    it('displays normal priority badge', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });

    it('displays low priority badge', () => {
      const lowItem: TriageItem = { ...mockItem, priority: 'low' };
      render(<TriageCard item={lowItem} />);
      expect(screen.getByText('Low priority')).toBeInTheDocument();
    });
  });

  describe('connector indicator', () => {
    it('displays Gmail indicator for gmail connector', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('Gmail')).toBeInTheDocument();
    });

    it('displays Slack indicator for slack connector', () => {
      const slackItem: TriageItem = { ...mockItem, connector: 'slack' };
      render(<TriageCard item={slackItem} />);
      expect(screen.getByText('Slack')).toBeInTheDocument();
    });

    it('displays Linear indicator for linear connector', () => {
      const linearItem: TriageItem = { ...mockItem, connector: 'linear' };
      render(<TriageCard item={linearItem} />);
      expect(screen.getByText('Linear')).toBeInTheDocument();
    });
  });

  describe('tags', () => {
    it('displays tags', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('#important')).toBeInTheDocument();
      expect(screen.getByText('#work')).toBeInTheDocument();
    });

    it('displays maximum of 3 tags', () => {
      const itemWithManyTags: TriageItem = {
        ...mockItem,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
      };
      render(<TriageCard item={itemWithManyTags} />);

      expect(screen.getByText('#tag1')).toBeInTheDocument();
      expect(screen.getByText('#tag2')).toBeInTheDocument();
      expect(screen.getByText('#tag3')).toBeInTheDocument();
      expect(screen.queryByText('#tag4')).not.toBeInTheDocument();
      expect(screen.getByText('+2')).toBeInTheDocument();
    });

    it('does not show overflow indicator when 3 or fewer tags', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    });
  });

  describe('enrichment display', () => {
    it('displays linked entities section', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('Linked:')).toBeInTheDocument();
      // Entities appear in both the linked section and sender area
      const johnDoeElements = screen.getAllByText('John Doe');
      expect(johnDoeElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('displays AI summary', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText(/"Test summary"/)).toBeInTheDocument();
    });

    it('displays context from memory when no summary', () => {
      const itemWithoutSummary: TriageItem = {
        ...mockItem,
        enrichment: {
          ...mockItem.enrichment!,
          summary: undefined,
        },
      };
      render(<TriageCard item={itemWithoutSummary} />);
      expect(screen.getByText(/"Previous conversation context"/)).toBeInTheDocument();
    });

    it('handles missing enrichment gracefully', () => {
      const itemWithoutEnrichment: TriageItem = {
        ...mockItem,
        enrichment: null,
      };
      render(<TriageCard item={itemWithoutEnrichment} />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Test Subject Line');
    });
  });

  describe('active state', () => {
    it('shows keyboard hints when active', () => {
      render(<TriageCard item={mockItem} isActive={true} />);

      expect(screen.getByText('Archive')).toBeInTheDocument();
      expect(screen.getByText('Memory')).toBeInTheDocument();
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Reply')).toBeInTheDocument();
    });

    it('hides keyboard hints when not active', () => {
      render(<TriageCard item={mockItem} isActive={false} />);

      expect(screen.queryByText('Archive')).not.toBeInTheDocument();
      expect(screen.queryByText('Memory')).not.toBeInTheDocument();
    });

    it('defaults to not active', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    });
  });

  describe('avatar', () => {
    it('displays avatar image when provided', () => {
      const itemWithAvatar: TriageItem = {
        ...mockItem,
        senderAvatar: 'https://example.com/avatar.jpg',
      };
      render(<TriageCard item={itemWithAvatar} />);

      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    });

    it('displays initial letter when no avatar', () => {
      render(<TriageCard item={mockItem} />);
      expect(screen.getByText('J')).toBeInTheDocument(); // First letter of John
    });

    it('uses first letter of sender when no senderName', () => {
      const itemWithoutName: TriageItem = {
        ...mockItem,
        senderName: null,
      };
      render(<TriageCard item={itemWithoutName} />);
      expect(screen.getByText('J')).toBeInTheDocument(); // First letter of john@acme.io
    });
  });

  describe('ref forwarding', () => {
    it('forwards ref to the card container', () => {
      const ref = { current: null };
      render(<TriageCard ref={ref} item={mockItem} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});

describe('formatTimeAgo (via TriageCard rendering)', () => {
  const baseItem: TriageItem = {
    id: 'test-id',
    externalId: 'ext-1',
    connector: 'gmail',
    sender: 'test@example.com',
    senderName: 'Test',
    senderAvatar: null,
    subject: 'Test',
    content: 'Test content',
    preview: null,
    status: 'new',
    priority: 'normal',
    tags: [],
    receivedAt: new Date().toISOString(),
    enrichment: null,
  };

  it('shows "just now" for very recent items', () => {
    const recentItem: TriageItem = {
      ...baseItem,
      receivedAt: new Date().toISOString(),
    };
    render(<TriageCard item={recentItem} />);
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('shows minutes ago for items less than an hour old', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const item: TriageItem = {
      ...baseItem,
      receivedAt: thirtyMinsAgo.toISOString(),
    };
    render(<TriageCard item={item} />);
    expect(screen.getByText('30m ago')).toBeInTheDocument();
  });

  it('shows hours ago for items less than a day old', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const item: TriageItem = {
      ...baseItem,
      receivedAt: fiveHoursAgo.toISOString(),
    };
    render(<TriageCard item={item} />);
    expect(screen.getByText('5h ago')).toBeInTheDocument();
  });

  it('shows days ago for items less than a week old', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const item: TriageItem = {
      ...baseItem,
      receivedAt: threeDaysAgo.toISOString(),
    };
    render(<TriageCard item={item} />);
    expect(screen.getByText('3d ago')).toBeInTheDocument();
  });
});
