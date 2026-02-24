"use client";

import { useState, useMemo } from "react";
import { Archive, Eye, AlertCircle, ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TriageCard } from "@/components/aurelius/triage-card";
import type { TriageItem } from "@/components/aurelius/triage-card";
import { SuggestedTasksBox } from "@/components/aurelius/suggested-tasks-box";

interface EmailTiersProps {
  items: TriageItem[];
  tasksByItemId: Record<string, unknown[]>;
  onBulkArchive: (items: TriageItem[]) => void;
  onSelectItem: (item: TriageItem) => void;
  activeItemId?: string;
}

type Tier = "archive" | "review" | "attention";

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

export function TriageEmailTiers({
  items,
  tasksByItemId,
  onBulkArchive,
  onSelectItem,
  activeItemId,
}: EmailTiersProps) {
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

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Tier 1: Ready to archive */}
      {archiveItems.length > 0 && (
        <ArchiveTier
          items={archiveItems}
          onBulkArchive={onBulkArchive}
        />
      )}

      {/* Tier 2: Quick review */}
      {reviewItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-medium text-gold">Quick review</h2>
            <span className="text-xs text-muted-foreground">
              ({reviewItems.length})
            </span>
          </div>
          <div className="space-y-4">
            {reviewItems.map((item) => (
              <div key={item.id} className="flex flex-col items-center gap-2">
                <div
                  className="cursor-pointer"
                  onClick={() => onSelectItem(item)}
                >
                  <TriageCard
                    item={item}
                    isActive={activeItemId === item.id}
                  />
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tier 3: Needs your attention */}
      {attentionItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-medium text-orange-400">
              Needs your attention
            </h2>
            <span className="text-xs text-muted-foreground">
              ({attentionItems.length})
            </span>
          </div>
          <div className="space-y-4">
            {attentionItems.map((item) => {
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
                  {/* Suggested tasks for the active/selected item */}
                  {isActive && (
                    <SuggestedTasksBox
                      itemId={itemDbId}
                      initialTasks={tasksByItemId[itemDbId] as any}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* All clear message when no items in any tier */}
      {archiveItems.length === 0 && reviewItems.length === 0 && attentionItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p>No emails to triage.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible archive tier with checklist and bulk archive button.
 */
function ArchiveTier({
  items,
  onBulkArchive,
}: {
  items: TriageItem[];
  onBulkArchive: (items: TriageItem[]) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
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
  };

  return (
    <section>
      {/* Collapsed summary card */}
      <div className="w-full max-w-2xl mx-auto rounded-lg border border-border bg-secondary/30">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium text-foreground">
              {items.length} email{items.length === 1 ? "" : "s"} ready to archive
            </span>
            <span className="text-xs text-muted-foreground">
              (90%+ confidence)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isExpanded && (
              <span
                role="button"
                tabIndex={0}
                className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleArchiveAll();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    handleArchiveAll();
                  }
                }}
              >
                Archive All
              </span>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Expanded checklist */}
        {isExpanded && (
          <div className="border-t border-border">
            <div className="divide-y divide-border/50">
              {items.map((item) => {
                const isChecked = !uncheckedIds.has(item.id);
                const reasoning = getReasoning(item);
                return (
                  <label
                    key={item.id}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 cursor-pointer transition-colors"
                  >
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
                );
              })}
            </div>

            {/* Footer with archive button */}
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
        )}
      </div>
    </section>
  );
}
