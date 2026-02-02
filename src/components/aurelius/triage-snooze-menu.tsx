"use client";

import { useEffect, useRef } from "react";
import { Clock, Sun, Calendar, CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SnoozeOption {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  duration: string; // e.g., "1h", "3h", "tomorrow", "next_week"
  getDate: () => Date;
}

const SNOOZE_OPTIONS: SnoozeOption[] = [
  {
    label: "1 hour",
    description: "Snooze for 1 hour",
    icon: Clock,
    duration: "1h",
    getDate: () => new Date(Date.now() + 60 * 60 * 1000),
  },
  {
    label: "3 hours",
    description: "Snooze for 3 hours",
    icon: Clock,
    duration: "3h",
    getDate: () => new Date(Date.now() + 3 * 60 * 60 * 1000),
  },
  {
    label: "Tomorrow morning",
    description: "9:00 AM tomorrow",
    icon: Sun,
    duration: "tomorrow",
    getDate: () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    },
  },
  {
    label: "Next week",
    description: "Monday 9:00 AM",
    icon: Calendar,
    duration: "next_week",
    getDate: () => {
      const nextMonday = new Date();
      const daysUntilMonday = (8 - nextMonday.getDay()) % 7 || 7;
      nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
      nextMonday.setHours(9, 0, 0, 0);
      return nextMonday;
    },
  },
  {
    label: "Next month",
    description: "First of next month",
    icon: CalendarDays,
    duration: "next_month",
    getDate: () => {
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);
      nextMonth.setHours(9, 0, 0, 0);
      return nextMonth;
    },
  },
];

interface TriageSnoozeMenuProps {
  onSnooze: (until: Date) => void;
  onClose: () => void;
}

export function TriageSnoozeMenu({ onSnooze, onClose }: TriageSnoozeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Number keys 1-5 for quick selection
      const num = parseInt(e.key);
      if (num >= 1 && num <= SNOOZE_OPTIONS.length) {
        e.preventDefault();
        const option = SNOOZE_OPTIONS[num - 1];
        onSnooze(option.getDate());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSnooze, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={menuRef}
        className="bg-background border border-border rounded-xl shadow-2xl w-[360px] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h3 className="font-medium">Snooze until...</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Options */}
        <div className="p-2">
          {SNOOZE_OPTIONS.map((option, idx) => {
            const Icon = option.icon;
            return (
              <button
                key={option.duration}
                onClick={() => onSnooze(option.getDate())}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                  "hover:bg-secondary transition-colors text-left group"
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-blue-400/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.description}
                  </div>
                </div>
                <kbd className="px-2 py-1 rounded bg-secondary border border-border text-xs font-mono text-muted-foreground group-hover:border-blue-400/50 group-hover:text-blue-400">
                  {idx + 1}
                </kbd>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border bg-secondary/30">
          <p className="text-xs text-muted-foreground text-center">
            Press <kbd className="px-1 rounded bg-background border border-border">1</kbd>-
            <kbd className="px-1 rounded bg-background border border-border">5</kbd> to select,
            <kbd className="px-1 rounded bg-background border border-border ml-1">Esc</kbd> to cancel
          </p>
        </div>
      </div>
    </div>
  );
}
