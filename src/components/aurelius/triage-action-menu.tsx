"use client";

import { useEffect, useCallback } from "react";
import {
  X,
  ListTodo,
  Clock,
  FolderOpen,
  Flag,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TriageItem } from "./triage-card";

interface TriageActionMenuProps {
  item: TriageItem;
  onAction: (action: string, data?: any) => void;
  onClose: () => void;
}

const SNOOZE_OPTIONS = [
  { key: "1", label: "1 hour", value: "1h" },
  { key: "4", label: "4 hours", value: "4h" },
  { key: "t", label: "Tomorrow 9am", value: "tomorrow" },
  { key: "w", label: "Next week", value: "nextweek" },
];

const PRIORITY_OPTIONS = [
  { key: "u", label: "Urgent", value: "urgent", icon: Zap, color: "text-red-400" },
  { key: "h", label: "High", value: "high", icon: AlertTriangle, color: "text-orange-400" },
  { key: "n", label: "Normal", value: "normal", icon: null, color: "text-blue-400" },
  { key: "l", label: "Low", value: "low", icon: null, color: "text-muted-foreground" },
];

export function TriageActionMenu({
  item,
  onAction,
  onClose,
}: TriageActionMenuProps) {
  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Direct actions
      switch (e.key.toLowerCase()) {
        case "t":
          onAction("actioned"); // Create task (simulated)
          break;
        case "f":
          onAction("flag");
          break;
        case "p":
          // Could open project picker
          break;
      }

      // Snooze shortcuts
      const snoozeOpt = SNOOZE_OPTIONS.find((o) => o.key === e.key);
      if (snoozeOpt) {
        onAction("snooze", { duration: snoozeOpt.value });
        return;
      }

      // Priority shortcuts
      const priorityOpt = PRIORITY_OPTIONS.find((o) => o.key === e.key.toLowerCase());
      if (priorityOpt) {
        onAction("priority", { priority: priorityOpt.value });
        return;
      }
    },
    [onAction, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="relative bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-medium">Actions</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-background transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick actions */}
        <div className="p-2">
          <ActionRow
            keyName="T"
            icon={ListTodo}
            label="Create task"
            description="Add to your task list"
            onClick={() => onAction("actioned")}
          />
          <ActionRow
            keyName="F"
            icon={Flag}
            label={item.tags.includes("flagged") ? "Remove flag" : "Flag"}
            description="Mark for follow-up"
            onClick={() => onAction("flag")}
            active={item.tags.includes("flagged")}
          />
          <ActionRow
            keyName="P"
            icon={FolderOpen}
            label="Link to project"
            description="Associate with a project"
            onClick={() => {
              // Would open project picker
              onClose();
            }}
            disabled
          />
        </div>

        {/* Snooze section */}
        <div className="px-4 py-2 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Snooze</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onAction("snooze", { duration: opt.value })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-background transition-colors text-left"
              >
                <kbd className="px-1.5 py-0.5 rounded bg-background border border-border font-mono text-xs">
                  {opt.key}
                </kbd>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Priority section */}
        <div className="px-4 py-2 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Set Priority</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onAction("priority", { priority: opt.value })}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-background transition-colors text-left",
                  item.priority === opt.value && "bg-background border border-border"
                )}
              >
                <kbd className="px-1.5 py-0.5 rounded bg-background border border-border font-mono text-xs">
                  {opt.key.toUpperCase()}
                </kbd>
                <span className={opt.color}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border text-center">
          <span className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

function ActionRow({
  keyName,
  icon: Icon,
  label,
  description,
  onClick,
  active,
  disabled,
}: {
  keyName: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-background",
        active && "bg-gold/10 border border-gold/30"
      )}
    >
      <kbd className="px-2 py-1 rounded bg-background border border-border font-mono text-sm shrink-0">
        {keyName}
      </kbd>
      <Icon className={cn("w-4 h-4 shrink-0", active && "text-gold")} />
      <div className="flex-1 min-w-0">
        <div className={cn("font-medium text-sm", active && "text-gold")}>
          {label}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {description}
        </div>
      </div>
    </button>
  );
}
