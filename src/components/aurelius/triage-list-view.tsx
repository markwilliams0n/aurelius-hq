"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  TriageItem,
  CONNECTOR_CONFIG,
  PRIORITY_CONFIG,
  formatTimeAgo,
} from "@/components/aurelius/triage-card";

export interface TriageListViewProps {
  items: TriageItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkArchive: () => void;
  onOpenItem: (id: string) => void;
  onActionNeeded?: (item: TriageItem) => void;
}

export function TriageListView({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkArchive,
  onOpenItem,
  onActionNeeded,
}: TriageListViewProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Keep focused index in bounds
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, focusedIndex]);

  // Scroll focused row into view
  useEffect(() => {
    const row = rowRefs.current.get(focusedIndex);
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedIndex]);

  // Keyboard navigation for list view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(items.length - 1, prev + 1));
          break;
        case " ":
          e.preventDefault();
          if (items[focusedIndex]) {
            onToggleSelect(items[focusedIndex].id);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (items[focusedIndex]) {
            onOpenItem(items[focusedIndex].id);
          }
          break;
        case "a":
          if (!e.shiftKey && items[focusedIndex]) {
            e.preventDefault();
            if (items[focusedIndex].connector !== "gmail") {
              toast.info("Action Needed is only available for Gmail items");
            } else if (onActionNeeded) {
              onActionNeeded(items[focusedIndex]);
            }
          }
          break;
        case "A":
          if (e.shiftKey) {
            e.preventDefault();
            if (selectedIds.size === items.length) {
              onClearSelection();
            } else {
              onSelectAll();
            }
          }
          break;
        case "Backspace":
        case "Delete":
          if (selectedIds.size > 0) {
            e.preventDefault();
            onBulkArchive();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    items,
    focusedIndex,
    selectedIds,
    onToggleSelect,
    onSelectAll,
    onClearSelection,
    onBulkArchive,
    onOpenItem,
    onActionNeeded,
  ]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <div ref={listRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2 border-b border-border bg-gold/5 flex items-center gap-3 shrink-0">
          <span className="text-xs text-gold font-medium">
            {selectedIds.size} selected
          </span>
          <button
            onClick={onBulkArchive}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            Archive selected
          </button>
          <button
            onClick={onClearSelection}
            className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Header row */}
      <div className="px-4 py-2 border-b border-border bg-background/50 flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <button
          onClick={() => (allSelected ? onClearSelection() : onSelectAll())}
          className={cn(
            "w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors",
            allSelected
              ? "bg-gold/20 border-gold/50 text-gold"
              : "border-border hover:border-muted-foreground"
          )}
        >
          {allSelected && <Check className="w-3 h-3" />}
        </button>
        <div className="w-8 shrink-0" /> {/* connector icon */}
        <div className="w-40 shrink-0">Sender</div>
        <div className="flex-1 min-w-0">Subject</div>
        <div className="w-24 shrink-0 text-right">Recipients</div>
        <div className="w-20 shrink-0 text-right">Priority</div>
        <div className="w-16 shrink-0 text-right">Time</div>
      </div>

      {/* List rows */}
      <div className="flex-1 overflow-y-auto">
        {items.map((item, index) => {
          const isSelected = selectedIds.has(item.id);
          const isFocused = index === focusedIndex;
          const connector = CONNECTOR_CONFIG[item.connector];
          const priority = PRIORITY_CONFIG[item.priority];
          const ConnectorIcon = connector.icon;
          const PriorityIcon = priority.icon;
          const timeAgo = formatTimeAgo(new Date(item.receivedAt));
          const internalRecipients =
            item.enrichment?.recipients?.internal || [];
          const senderDisplay = item.senderName || item.sender;

          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) rowRefs.current.set(index, el);
                else rowRefs.current.delete(index);
              }}
              onClick={() => onOpenItem(item.id)}
              className={cn(
                "px-4 py-2.5 flex items-center gap-3 border-b border-border/50 cursor-pointer transition-colors group",
                isFocused && "bg-secondary/80",
                isSelected && "border-l-2 border-l-gold/60 bg-gold/5",
                !isFocused && !isSelected && "hover:bg-secondary/50"
              )}
            >
              {/* Checkbox */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(item.id);
                }}
                className={cn(
                  "w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors",
                  isSelected
                    ? "bg-gold/20 border-gold/50 text-gold"
                    : "border-border group-hover:border-muted-foreground"
                )}
              >
                {isSelected && <Check className="w-3 h-3" />}
              </button>

              {/* Connector icon */}
              <div
                className={cn(
                  "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                  connector.bgColor
                )}
              >
                <ConnectorIcon className={cn("w-4 h-4", connector.color)} />
              </div>

              {/* Sender */}
              <div className="w-40 shrink-0 truncate">
                <span className="text-sm font-medium text-foreground">
                  {senderDisplay}
                </span>
              </div>

              {/* Subject */}
              <div className="flex-1 min-w-0 truncate">
                <span className="text-sm text-muted-foreground">
                  {item.subject}
                </span>
              </div>

              {/* Internal recipients */}
              <div className="w-24 shrink-0 text-right">
                {internalRecipients.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-400 border border-green-500/20">
                    <Users className="w-2.5 h-2.5" />
                    {internalRecipients.length === 1
                      ? internalRecipients[0].email
                          .replace("@rostr.cc", "")
                      : `${internalRecipients.length} @rostr`}
                  </span>
                )}
              </div>

              {/* Priority badge */}
              <div className="w-20 shrink-0 text-right">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                    priority.className
                  )}
                >
                  <PriorityIcon className="w-2.5 h-2.5" />
                  {priority.label}
                </span>
              </div>

              {/* Time */}
              <div className="w-16 shrink-0 text-right">
                <span className="text-xs text-muted-foreground">
                  {timeAgo}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom hints */}
      <div className="px-4 py-2 border-t border-border bg-background/50 shrink-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <ListKeyHint keyName="Up/Down" label="Navigate" />
          <ListKeyHint keyName="Space" label="Select" />
          <ListKeyHint keyName="Enter" label="Open" />
          <ListKeyHint keyName="a" label="Action Needed" />
          <ListKeyHint keyName="Shift+A" label="Select all" />
          <ListKeyHint keyName="Del" label="Archive selected" />
          <ListKeyHint keyName="v" label="Card view" />
          <ListKeyHint keyName="Esc" label="Back" />
        </div>
      </div>
    </div>
  );
}

function ListKeyHint({
  keyName,
  label,
}: {
  keyName: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
        {keyName}
      </kbd>
      <span>{label}</span>
    </div>
  );
}
