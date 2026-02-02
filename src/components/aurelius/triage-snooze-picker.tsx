"use client";

import { useState, useEffect } from "react";
import { X, Clock, Calendar, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TriageSnoozPickerProps {
  onSnooze: (duration: string, customDate?: Date) => void;
  onClose: () => void;
}

// Preset snooze options
const PRESETS = [
  { key: "1", label: "1 hour", value: "1h", icon: Clock },
  { key: "4", label: "4 hours", value: "4h", icon: Clock },
  { key: "t", label: "Tomorrow 9am", value: "tomorrow", icon: Sun },
  { key: "w", label: "Next week", value: "nextweek", icon: Calendar },
  { key: "e", label: "This evening", value: "evening", icon: Moon },
  { key: "m", label: "Next month", value: "nextmonth", icon: Calendar },
];

export function TriageSnoozePicker({ onSnooze, onClose }: TriageSnoozPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");

  // Calculate snooze time from presets
  const getSnoozeDate = (value: string): Date => {
    const now = new Date();

    switch (value) {
      case "1h":
        return new Date(now.getTime() + 60 * 60 * 1000);
      case "4h":
        return new Date(now.getTime() + 4 * 60 * 60 * 1000);
      case "tomorrow": {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return tomorrow;
      }
      case "evening": {
        const evening = new Date(now);
        if (now.getHours() >= 18) {
          evening.setDate(evening.getDate() + 1);
        }
        evening.setHours(18, 0, 0, 0);
        return evening;
      }
      case "nextweek": {
        const nextWeek = new Date(now);
        const daysUntilMonday = (8 - nextWeek.getDay()) % 7 || 7;
        nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
        nextWeek.setHours(9, 0, 0, 0);
        return nextWeek;
      }
      case "nextmonth": {
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(9, 0, 0, 0);
        return nextMonth;
      }
      default:
        return new Date(now.getTime() + 60 * 60 * 1000);
    }
  };

  // Format date for display
  const formatSnoozeDate = (date: Date): string => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    if (isToday) {
      return `Today at ${timeStr}`;
    }
    if (isTomorrow) {
      return `Tomorrow at ${timeStr}`;
    }

    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showCustom) {
          setShowCustom(false);
        } else {
          onClose();
        }
        return;
      }

      if (showCustom) return;

      // Preset shortcuts
      const preset = PRESETS.find((p) => p.key === e.key.toLowerCase());
      if (preset) {
        onSnooze(preset.value);
      }

      // Custom time shortcut
      if (e.key === "c") {
        setShowCustom(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCustom, onSnooze, onClose]);

  // Handle custom snooze
  const handleCustomSnooze = () => {
    if (!customDate) return;

    const [hours, minutes] = customTime.split(":").map(Number);
    const date = new Date(customDate);
    date.setHours(hours, minutes, 0, 0);

    onSnooze("custom", date);
  };

  // Set default custom date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCustomDate(tomorrow.toISOString().split("T")[0]);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Picker */}
      <div className="relative bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold" />
            <h3 className="font-medium">Snooze until...</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-background transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showCustom ? (
          /* Custom date/time picker */
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Date</label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Time</label>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>

            {/* Preview */}
            {customDate && (
              <div className="p-3 rounded-lg bg-gold/10 border border-gold/20 text-sm">
                <span className="text-muted-foreground">Will reappear: </span>
                <span className="text-gold font-medium">
                  {formatSnoozeDate(
                    new Date(`${customDate}T${customTime}:00`)
                  )}
                </span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowCustom(false)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-background transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleCustomSnooze}
                disabled={!customDate}
                className={cn(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  customDate
                    ? "bg-gold text-background hover:bg-gold/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                Snooze
              </button>
            </div>
          </div>
        ) : (
          /* Preset options */
          <div className="p-2">
            {PRESETS.map((preset) => {
              const Icon = preset.icon;
              const snoozeDate = getSnoozeDate(preset.value);

              return (
                <button
                  key={preset.value}
                  onClick={() => onSnooze(preset.value)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-background transition-colors"
                >
                  <kbd className="px-2 py-1 rounded bg-background border border-border font-mono text-sm shrink-0">
                    {preset.key.toUpperCase()}
                  </kbd>
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{preset.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSnoozeDate(snoozeDate)}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Custom option */}
            <button
              onClick={() => setShowCustom(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-background transition-colors border-t border-border mt-2 pt-4"
            >
              <kbd className="px-2 py-1 rounded bg-background border border-border font-mono text-sm shrink-0">
                C
              </kbd>
              <Calendar className="w-4 h-4 text-gold shrink-0" />
              <div className="flex-1">
                <div className="font-medium text-sm text-gold">
                  Custom date & time
                </div>
                <div className="text-xs text-muted-foreground">
                  Pick a specific time
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border text-center">
          <span className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
              Esc
            </kbd>{" "}
            to cancel
          </span>
        </div>
      </div>
    </div>
  );
}
