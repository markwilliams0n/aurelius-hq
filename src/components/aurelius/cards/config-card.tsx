"use client";

import { useState } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import { cn } from "@/lib/utils";

interface ConfigCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
}

/**
 * Config pattern: "Here's state you can view or change."
 * Key-value display with inline editing in pending state.
 */
export function ConfigCardContent({ card, onDataChange }: ConfigCardContentProps) {
  const isPending = card.status === "pending";
  const entries = card.data.entries as Array<{ key: string; value: string; editable?: boolean }> | undefined;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Structured entries mode
  if (entries) {
    return (
      <div className="space-y-1 text-sm">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0 min-w-[100px]">{entry.key}:</span>
            {isPending && entry.editable && editingKey === entry.key ? (
              <div className="flex-1 flex items-center gap-1">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-muted/50 border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const updated = entries.map((ent) =>
                        ent.key === entry.key ? { ...ent, value: editValue } : ent
                      );
                      onDataChange?.({ ...card.data, entries: updated });
                      setEditingKey(null);
                    }
                    if (e.key === "Escape") setEditingKey(null);
                  }}
                />
              </div>
            ) : (
              <span
                className={cn(
                  "text-foreground",
                  isPending && entry.editable && "cursor-text hover:text-gold transition-colors"
                )}
                onClick={() => {
                  if (isPending && entry.editable) {
                    setEditingKey(entry.key);
                    setEditValue(entry.value);
                  }
                }}
              >
                {entry.value || <span className="text-muted-foreground italic">empty</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Fallback: raw data display
  return (
    <div className="space-y-1 text-sm">
      {Object.entries(card.data).map(([key, value]) => (
        <p key={key}>
          <span className="text-muted-foreground">{key}: </span>
          <span className="text-foreground">{String(value)}</span>
        </p>
      ))}
    </div>
  );
}
