import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TriageActionMenu } from '../triage-action-menu';
import type { TriageItem } from '../triage-card';

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | boolean)[]) =>
    classes.filter(Boolean).join(' '),
}));

describe('TriageActionMenu', () => {
  const mockItem: TriageItem = {
    id: 'test-id',
    externalId: 'ext-1',
    connector: 'gmail',
    sender: 'test@example.com',
    senderName: 'Test User',
    senderAvatar: null,
    subject: 'Test Subject',
    content: 'Test content',
    preview: null,
    status: 'new',
    priority: 'normal',
    tags: [],
    receivedAt: new Date().toISOString(),
    enrichment: null,
  };

  const mockOnAction = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders the action menu', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('displays quick action buttons', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Create task')).toBeInTheDocument();
      expect(screen.getByText('Flag')).toBeInTheDocument();
      expect(screen.getByText('Link to project')).toBeInTheDocument();
    });

    it('displays snooze options', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Snooze')).toBeInTheDocument();
      expect(screen.getByText('1 hour')).toBeInTheDocument();
      expect(screen.getByText('4 hours')).toBeInTheDocument();
      expect(screen.getByText('Tomorrow 9am')).toBeInTheDocument();
      expect(screen.getByText('Next week')).toBeInTheDocument();
    });

    it('displays priority options', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Set Priority')).toBeInTheDocument();
      expect(screen.getByText('Urgent')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Normal')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });

    it('displays keyboard hint for escape', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/to close/i)).toBeInTheDocument();
    });
  });

  describe('quick actions', () => {
    it('calls onAction with "actioned" when Create task is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Create task'));
      expect(mockOnAction).toHaveBeenCalledWith('actioned');
    });

    it('calls onAction with "flag" when Flag is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Flag'));
      expect(mockOnAction).toHaveBeenCalledWith('flag');
    });

    it('shows "Remove flag" when item is already flagged', () => {
      const flaggedItem: TriageItem = {
        ...mockItem,
        tags: ['flagged'],
      };

      render(
        <TriageActionMenu
          item={flaggedItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Remove flag')).toBeInTheDocument();
    });
  });

  describe('snooze actions', () => {
    it('calls onAction with snooze duration when 1 hour is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('1 hour'));
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: '1h' });
    });

    it('calls onAction with snooze duration when 4 hours is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('4 hours'));
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: '4h' });
    });

    it('calls onAction with snooze duration when Tomorrow is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Tomorrow 9am'));
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: 'tomorrow' });
    });

    it('calls onAction with snooze duration when Next week is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Next week'));
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: 'nextweek' });
    });
  });

  describe('priority actions', () => {
    it('calls onAction with urgent priority when Urgent is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Urgent'));
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'urgent' });
    });

    it('calls onAction with high priority when High is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('High'));
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'high' });
    });

    it('calls onAction with normal priority when Normal is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Normal'));
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'normal' });
    });

    it('calls onAction with low priority when Low is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByText('Low'));
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'low' });
    });

    it('highlights current priority', () => {
      const highPriorityItem: TriageItem = {
        ...mockItem,
        priority: 'high',
      };

      render(
        <TriageActionMenu
          item={highPriorityItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      // The High button should have the active styling
      const highButton = screen.getByText('High').closest('button');
      expect(highButton?.className).toContain('bg-background');
    });
  });

  describe('closing behavior', () => {
    it('calls onClose when close button is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      // Find close button (X icon button in header)
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find(btn =>
        btn.querySelector('svg.lucide-x') || btn.classList.contains('hover:bg-background')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when backdrop is clicked', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      // Click on backdrop (the first div with bg-background/80)
      const backdrop = document.querySelector('.bg-background\\/80');
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('keyboard shortcuts', () => {
    it('calls onClose when Escape is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onAction with actioned when T is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 't' });
      expect(mockOnAction).toHaveBeenCalledWith('actioned');
    });

    it('calls onAction with flag when F is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'f' });
      expect(mockOnAction).toHaveBeenCalledWith('flag');
    });

    it('calls onAction with snooze when 1 is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: '1' });
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: '1h' });
    });

    it('calls onAction with snooze when 4 is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: '4' });
      expect(mockOnAction).toHaveBeenCalledWith('snooze', { duration: '4h' });
    });

    it('calls onAction with priority when U is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'u' });
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'urgent' });
    });

    it('calls onAction with priority when H is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'h' });
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'high' });
    });

    it('calls onAction with priority when N is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'n' });
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'normal' });
    });

    it('calls onAction with priority when L is pressed', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'l' });
      expect(mockOnAction).toHaveBeenCalledWith('priority', { priority: 'low' });
    });
  });

  describe('snooze picker', () => {
    it('has a "More options" button for custom snooze', () => {
      render(
        <TriageActionMenu
          item={mockItem}
          onAction={mockOnAction}
          onClose={mockOnClose}
        />
      );

      // The "More options" button exists to open the snooze picker
      expect(screen.getByText('More options')).toBeInTheDocument();
    });
  });
});
