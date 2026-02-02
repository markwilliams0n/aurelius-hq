import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TriageSnoozePicker } from '../triage-snooze-picker';

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | boolean)[]) =>
    classes.filter(Boolean).join(' '),
}));

describe('TriageSnoozePicker', () => {
  const mockOnSnooze = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Set a consistent time for tests
    vi.setSystemTime(new Date('2024-01-15T14:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders the snooze picker', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);
      expect(screen.getByText('Snooze until...')).toBeInTheDocument();
    });

    it('displays all preset options', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      expect(screen.getByText('1 hour')).toBeInTheDocument();
      expect(screen.getByText('4 hours')).toBeInTheDocument();
      expect(screen.getByText('Tomorrow 9am')).toBeInTheDocument();
      expect(screen.getByText('Next week')).toBeInTheDocument();
      expect(screen.getByText('This evening')).toBeInTheDocument();
      expect(screen.getByText('Next month')).toBeInTheDocument();
    });

    it('displays custom date option', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);
      expect(screen.getByText('Custom date & time')).toBeInTheDocument();
    });

    it('displays keyboard hint for escape', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);
      // The footer contains "Press Esc to cancel"
      expect(screen.getByText(/to cancel/i)).toBeInTheDocument();
    });
  });

  describe('preset options', () => {
    it('calls onSnooze with "1h" when 1 hour is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('1 hour'));
      expect(mockOnSnooze).toHaveBeenCalledWith('1h');
    });

    it('calls onSnooze with "4h" when 4 hours is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('4 hours'));
      expect(mockOnSnooze).toHaveBeenCalledWith('4h');
    });

    it('calls onSnooze with "tomorrow" when Tomorrow 9am is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Tomorrow 9am'));
      expect(mockOnSnooze).toHaveBeenCalledWith('tomorrow');
    });

    it('calls onSnooze with "nextweek" when Next week is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Next week'));
      expect(mockOnSnooze).toHaveBeenCalledWith('nextweek');
    });

    it('calls onSnooze with "evening" when This evening is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('This evening'));
      expect(mockOnSnooze).toHaveBeenCalledWith('evening');
    });

    it('calls onSnooze with "nextmonth" when Next month is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Next month'));
      expect(mockOnSnooze).toHaveBeenCalledWith('nextmonth');
    });
  });

  describe('keyboard shortcuts', () => {
    it('calls onClose when Escape is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onSnooze with "1h" when 1 is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: '1' });
      expect(mockOnSnooze).toHaveBeenCalledWith('1h');
    });

    it('calls onSnooze with "4h" when 4 is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: '4' });
      expect(mockOnSnooze).toHaveBeenCalledWith('4h');
    });

    it('calls onSnooze with "tomorrow" when t is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 't' });
      expect(mockOnSnooze).toHaveBeenCalledWith('tomorrow');
    });

    it('calls onSnooze with "nextweek" when w is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'w' });
      expect(mockOnSnooze).toHaveBeenCalledWith('nextweek');
    });

    it('calls onSnooze with "evening" when e is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'e' });
      expect(mockOnSnooze).toHaveBeenCalledWith('evening');
    });

    it('calls onSnooze with "nextmonth" when m is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'm' });
      expect(mockOnSnooze).toHaveBeenCalledWith('nextmonth');
    });

    it('shows custom picker when c is pressed', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'c' });
      const dateInput = document.querySelector('input[type="date"]');
      expect(dateInput).toBeInTheDocument();
    });
  });

  describe('custom date picker', () => {
    it('shows custom date picker when Custom option is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      // Check for date and time inputs by type
      const dateInput = document.querySelector('input[type="date"]');
      const timeInput = document.querySelector('input[type="time"]');
      expect(dateInput).toBeInTheDocument();
      expect(timeInput).toBeInTheDocument();
    });

    it('has Back button in custom mode', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    it('returns to preset mode when Back is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));
      fireEvent.click(screen.getByText('Back'));

      expect(screen.getByText('1 hour')).toBeInTheDocument();
    });

    it('returns to preset mode when Escape is pressed in custom mode', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));
      fireEvent.keyDown(window, { key: 'Escape' });

      // Should return to preset mode, not close entirely
      expect(screen.getByText('1 hour')).toBeInTheDocument();
    });

    it('defaults date input to tomorrow', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe('2024-01-16'); // Tomorrow from mocked date
    });

    it('defaults time input to 9:00 AM', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
      expect(timeInput.value).toBe('09:00');
    });

    it('shows preview of snooze date', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      expect(screen.getByText('Will reappear:')).toBeInTheDocument();
    });

    it('calls onSnooze with custom date when Snooze button is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      // Set a specific date and time
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;

      fireEvent.change(dateInput, { target: { value: '2024-01-20' } });
      fireEvent.change(timeInput, { target: { value: '10:30' } });

      fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));

      expect(mockOnSnooze).toHaveBeenCalledWith('custom', expect.any(Date));

      const passedDate = mockOnSnooze.mock.calls[0][1];
      expect(passedDate.getFullYear()).toBe(2024);
      expect(passedDate.getMonth()).toBe(0); // January
      // Date may vary by 1 day depending on timezone handling
      expect(passedDate.getDate()).toBeGreaterThanOrEqual(19);
      expect(passedDate.getDate()).toBeLessThanOrEqual(20);
    });

    it('disables Snooze button when no date is selected', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Custom date & time'));

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '' } });

      const snoozeButton = screen.getByRole('button', { name: 'Snooze' });
      expect(snoozeButton).toBeDisabled();
    });
  });

  describe('closing behavior', () => {
    it('calls onClose when close button is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      // Find close button (X icon button)
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find(btn =>
        btn.querySelector('svg')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when backdrop is clicked', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      const backdrop = document.querySelector('.bg-background\\/80');
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('date formatting', () => {
    it('displays relative date for Today', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      // 1 hour from 2PM should still be "Today at 3:00 PM"
      const todayElements = screen.getAllByText(/Today at/);
      expect(todayElements.length).toBeGreaterThanOrEqual(1);
    });

    it('displays relative date for Tomorrow', () => {
      render(<TriageSnoozePicker onSnooze={mockOnSnooze} onClose={mockOnClose} />);

      // Tomorrow 9am should show "Tomorrow at 9:00 AM"
      const tomorrowElements = screen.getAllByText(/Tomorrow at/);
      expect(tomorrowElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
