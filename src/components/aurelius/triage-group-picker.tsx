"use client";

import { useEffect, useCallback } from "react";
import {
  Bell,
  DollarSign,
  Newspaper,
  Calendar,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriageItem } from "./triage-card";

const GROUPS = [
  { key: "1", value: "notifications", label: "Notifications", icon: Bell, color: "text-blue-400" },
  { key: "2", value: "finance", label: "Finance", icon: DollarSign, color: "text-green-400" },
  { key: "3", value: "newsletters", label: "Newsletters", icon: Newspaper, color: "text-purple-400" },
  { key: "4", value: "calendar", label: "Calendar", icon: Calendar, color: "text-amber-400" },
  { key: "5", value: "spam", label: "Spam", icon: Trash2, color: "text-red-400" },
];

interface TriageGroupPickerProps {
  item: TriageItem;
  onSelect: (batchType: string) => void;
  onClose: () => void;
}

export function TriageGroupPicker({ item, onSelect, onClose }: TriageGroupPickerProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const group = GROUPS.find((g) => g.key === e.key);
      if (group) {
        e.preventDefault();
        onSelect(group.value);
      }
    },
    [onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-150">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-medium text-sm">Classify into Group</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-background transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2 text-xs text-muted-foreground px-4 pb-1">
          <span className="truncate block">
            {item.senderName || item.sender}: {item.subject}
          </span>
          <span className="text-[10px]">
            A rule will be created for <strong>{item.sender}</strong>
          </span>
        </div>

        <div className="p-2 space-y-1">
          {GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <button
                key={group.value}
                onClick={() => onSelect(group.value)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-background transition-colors"
              >
                <kbd className="px-2 py-1 rounded bg-background border border-border font-mono text-sm shrink-0">
                  {group.key}
                </kbd>
                <Icon className={cn("w-4 h-4 shrink-0", group.color)} />
                <span className="font-medium text-sm">{group.label}</span>
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-border text-center">
          <span className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">Esc</kbd> to cancel
          </span>
        </div>
      </div>
    </div>
  );
}
