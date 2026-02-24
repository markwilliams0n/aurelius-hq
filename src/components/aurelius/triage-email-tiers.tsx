"use client";

import { useState, useMemo } from "react";
import { Archive, Eye, AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TriageCard } from "@/components/aurelius/triage-card";
import type { TriageItem } from "@/components/aurelius/triage-card";
import { SuggestedTasksBox } from "@/components/aurelius/suggested-tasks-box";

interface EmailTiersProps {
  items: TriageItem[];
  tasksByItemId: Record<string, unknown[]>;
  onBulkArchive: (items: TriageItem[]) => void;
  onSelectItem: (item: TriageItem) => void;
  onSkipFromArchive?: (item: TriageItem) => void;
  activeItemId?: string;
}

type Tier = "archive" | "review" | "attention";
type TierFilter = "all" | "archive" | "review" | "attention";

function getTier(item: TriageItem): Tier {
  const classification = (item as Record<string, unknown>).classification as Record<string, unknown> | null;
  const recommendation = classification?.recommendation as string;
  const confidence = (classification?.confidence as number) ?? 0;

  if (recommendation === "archive" && confidence >= 0.90) return "archive";
  if (recommendation === "archive" || recommendation === "review") return "review";
  return "attention";
}

function getReasoning(item: TriageItem): string | null {
  const classification = (item as Record<string, unknown>).classification as Record<string, unknown> | null;
  return (classification?.reasoning as string) ?? null;
}

function getConfidence(item: TriageItem): number {
  const classification = (item as Record<string, unknown>).classification as Record<string, unknown> | null;
  return (classification?.confidence as number) ?? 0;
}

function FilterPill({ label, count, active, onClick, color, icon }: {
  label: string; count: number; active: boolean; onClick: () => void;
  color?: "green" | "gold" | "orange"; icon?: React.ReactNode;
}) {
  const colorClasses = {
    green: active ? "bg-green-500/20 text-green-400" : "",
    gold: active ? "bg-gold/20 text-gold" : "",
    orange: active ? "bg-orange-500/20 text-orange-400" : "",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
        active && !color && "bg-foreground/10 text-foreground",
        active && color && colorClasses[color],
        !active && "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
      )}
    >
      {icon}
      {label}
      <span className={cn(
        "px-1.5 py-0.5 rounded-full text-[10px]",
        active ? "bg-foreground/10" : "bg-secondary"
      )}>
        {count}
      </span>
    </button>
  );
}

export function TriageEmailTiers({
  items,
  tasksByItemId,
  onBulkArchive,
  onSelectItem,
  onSkipFromArchive,
  activeItemId,
}: EmailTiersProps) {
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  const { archiveItems, reviewItems, attentionItems } = useMemo(() => {
    const archive: TriageItem[] = [];
    const review: TriageItem[] = [];
    const attention: TriageItem[] = [];

    for (const item of items) {
      const tier = getTier(item);
      if (tier === "archive") archive.push(item);
      else if (tier === "review") review.push(item);
      else attention.push(item);
    }

    return { archiveItems: archive, reviewItems: review, attentionItems: attention };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (tierFilter === "archive") return archiveItems;
    if (tierFilter === "review") return reviewItems;
    if (tierFilter === "attention") return attentionItems;
    return items;
  }, [tierFilter, archiveItems, reviewItems, attentionItems, items]);

  const showArchiveBox = tierFilter === "archive";
  const showCards = tierFilter !== "archive";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter pills bar */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <FilterPill
          label="All"
          count={items.length}
          active={tierFilter === "all"}
          onClick={() => setTierFilter("all")}
        />
        <FilterPill
          label="Archive"
          count={archiveItems.length}
          active={tierFilter === "archive"}
          onClick={() => setTierFilter("archive")}
          color="green"
          icon={<Archive className="w-3 h-3" />}
        />
        <FilterPill
          label="Review"
          count={reviewItems.length}
          active={tierFilter === "review"}
          onClick={() => setTierFilter("review")}
          color="gold"
          icon={<Eye className="w-3 h-3" />}
        />
        <FilterPill
          label="Attention"
          count={attentionItems.length}
          active={tierFilter === "attention"}
          onClick={() => setTierFilter("attention")}
          color="orange"
          icon={<AlertCircle className="w-3 h-3" />}
        />
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p>No emails in this category.</p>
          </div>
        )}

        {showArchiveBox && archiveItems.length > 0 && (
          <ArchiveBatchBox
            items={archiveItems}
            onBulkArchive={onBulkArchive}
            onSkipFromArchive={onSkipFromArchive}
          />
        )}

        {showCards && filteredItems.length > 0 && (
          <div className="space-y-4">
            {filteredItems.map((item) => {
              const tier = getTier(item);
              const isActive = activeItemId === item.id;
              const itemDbId = item.dbId || item.id;
              return (
                <div key={item.id} className="flex flex-col items-center gap-2">
                  <div
                    className="cursor-pointer"
                    onClick={() => onSelectItem(item)}
                  >
                    <TriageCard item={item} isActive={isActive} />
                  </div>
                  {/* AI reasoning */}
                  {getReasoning(item) && (
                    <div className="w-[640px] max-w-2xl px-4 py-2 rounded-lg bg-secondary/30 border border-border/50">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">AI:</span>{" "}
                        {getReasoning(item)}
                        <span className="ml-2 text-[10px] opacity-60">
                          ({Math.round(getConfidence(item) * 100)}% confidence)
                        </span>
                      </p>
                    </div>
                  )}
                  {/* Suggested tasks for attention items when active */}
                  {tier === "attention" && isActive && (
                    <SuggestedTasksBox
                      itemId={itemDbId}
                      initialTasks={tasksByItemId[itemDbId] as any}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Archive batch box with checklist, bulk archive, and skip buttons.
 */
function ArchiveBatchBox({
  items,
  onBulkArchive,
  onSkipFromArchive,
}: {
  items: TriageItem[];
  onBulkArchive: (items: TriageItem[]) => void;
  onSkipFromArchive?: (item: TriageItem) => void;
}) {
  const [uncheckedIds, setUncheckedIds] = useState<Set<string>>(new Set());

  const checkedItems = items.filter((i) => !uncheckedIds.has(i.id));

  const toggleItem = (id: string) => {
    setUncheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleArchiveAll = () => {
    if (checkedItems.length === 0) return;
    onBulkArchive(checkedItems);
    setUncheckedIds(new Set());
  };

  const handleSkip = (item: TriageItem) => {
    // Remove from local unchecked set
    setUncheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    onSkipFromArchive?.(item);
  };

  return (
    <div className="w-full max-w-2xl mx-auto rounded-lg border border-border bg-secondary/30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-foreground">
            {items.length} email{items.length === 1 ? "" : "s"} ready to archive
          </span>
          <span className="text-xs text-muted-foreground">
            (90%+ confidence)
          </span>
        </div>
        <button
          onClick={handleArchiveAll}
          disabled={checkedItems.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Archive className="w-3 h-3" />
          Archive {checkedItems.length === items.length ? "All" : checkedItems.length}
        </button>
      </div>

      {/* Checklist */}
      <div className="divide-y divide-border/50">
        {items.map((item) => {
          const isChecked = !uncheckedIds.has(item.id);
          const reasoning = getReasoning(item);
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors"
            >
              <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                <div className="pt-0.5">
                  <div
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                      isChecked
                        ? "bg-green-500/30 border-green-500/50 text-green-400"
                        : "border-border bg-secondary"
                    )}
                  >
                    {isChecked && <Check className="w-3 h-3" />}
                  </div>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleItem(item.id)}
                    className="sr-only"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium truncate">
                      {item.senderName || item.sender}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {item.subject}
                    </span>
                  </div>
                  {reasoning && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {reasoning}
                    </p>
                  )}
                </div>
              </label>
              {onSkipFromArchive && (
                <button
                  onClick={() => handleSkip(item)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5"
                  title="Move to Review"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
        <span className="text-xs text-muted-foreground">
          {checkedItems.length} of {items.length} selected
        </span>
        <button
          onClick={handleArchiveAll}
          disabled={checkedItems.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Archive className="w-3 h-3" />
          Archive {checkedItems.length === items.length ? "All" : checkedItems.length}
        </button>
      </div>
    </div>
  );
}
