"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mail,
  MessageSquare,
  LayoutList,
  CalendarDays,
  Check,
  Square,
  CheckSquare,
  Send,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BatchCardWithItems } from "@/lib/triage/batch-cards";

// Connector icon config (subset matching triage-card.tsx)
const CONNECTOR_ICON: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  gmail: { icon: Mail, color: "text-red-400" },
  slack: { icon: MessageSquare, color: "text-purple-400" },
  linear: { icon: LayoutList, color: "text-indigo-400" },
  granola: { icon: CalendarDays, color: "text-amber-400" },
  manual: { icon: Mail, color: "text-muted-foreground" },
};

// Batch type options for reclassify dropdown
const BATCH_TYPES = [
  { value: "notifications", label: "Notifications" },
  { value: "finance", label: "Finance" },
  { value: "newsletters", label: "Newsletters" },
  { value: "calendar", label: "Calendar" },
  { value: "spam", label: "Spam" },
];

// Tier badge config
const TIER_CONFIG: Record<string, { label: string; className: string }> = {
  rule: {
    label: "Rule",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  ollama: {
    label: "Ollama",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  kimi: {
    label: "Kimi",
    className: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
};

interface TriageBatchCardProps {
  card: BatchCardWithItems;
  isActive: boolean;
  onAction: (
    cardId: string,
    checkedItemIds: string[],
    uncheckedItemIds: string[]
  ) => void;
  onRuleInput: (input: string) => void;
  onReclassify?: (
    itemId: string,
    fromBatchType: string,
    toBatchType: string,
    sender: string,
    senderName: string | null,
    connector: string
  ) => Promise<void>;
  rules?: Array<{
    id: string;
    name: string;
    trigger: { sender?: string; senderDomain?: string; subjectContains?: string; pattern?: string } | null;
    source: string;
    matchCount: number;
    createdAt: string;
  }>;
  onDeleteRule?: (ruleId: string) => void;
}

export function TriageBatchCard({
  card,
  isActive,
  onAction,
  onRuleInput,
  onReclassify,
  rules,
  onDeleteRule,
}: TriageBatchCardProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(card.items.map((item) => item.id))
  );
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [ruleInput, setRuleInput] = useState("");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const lastToggledIndex = useRef<number>(-1);
  const ruleInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const checkedCount = checkedIds.size;
  const totalCount = card.items.length;
  const actionLabel = (card.data?.action as string) || "Archive";
  const explanation = (card.data?.explanation as string) || "";
  const batchType = (card.data?.batchType as string) || "";

  // Toggle a single item
  const toggleItem = useCallback(
    (id: string, index: number) => {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastToggledIndex.current = index;
    },
    []
  );

  // Select range from last toggled to current
  const selectRange = useCallback(
    (toIndex: number) => {
      const fromIndex =
        lastToggledIndex.current >= 0 ? lastToggledIndex.current : 0;
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(card.items[i].id);
        }
        return next;
      });
      lastToggledIndex.current = toIndex;
    },
    [card.items]
  );

  // Check all
  const checkAll = useCallback(() => {
    setCheckedIds(new Set(card.items.map((item) => item.id)));
  }, [card.items]);

  // Uncheck all
  const uncheckAll = useCallback(() => {
    setCheckedIds(new Set());
  }, []);

  // Execute batch action
  const executeBatchAction = useCallback(() => {
    const checked = Array.from(checkedIds);
    const unchecked = card.items
      .filter((item) => !checkedIds.has(item.id))
      .map((item) => item.id);
    onAction(card.id, checked, unchecked);
  }, [card.id, card.items, checkedIds, onAction]);

  // Submit rule input
  const submitRule = useCallback(() => {
    const trimmed = ruleInput.trim();
    if (!trimmed) return;
    onRuleInput(trimmed);
    setRuleInput("");
  }, [ruleInput, onRuleInput]);

  // Keyboard handling when active
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow typing in the rule input
      if (e.target === ruleInputRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          submitRule();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          ruleInputRef.current?.blur();
        }
        return;
      }

      // Ignore if in another input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) =>
            Math.min(prev + 1, card.items.length - 1)
          );
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < card.items.length) {
            if (e.shiftKey) {
              selectRange(focusedIndex);
            } else {
              toggleItem(card.items[focusedIndex].id, focusedIndex);
            }
          }
          break;
        case "a":
          e.preventDefault();
          checkAll();
          break;
        case "n":
          e.preventDefault();
          uncheckAll();
          break;
        case "ArrowLeft":
          e.preventDefault();
          executeBatchAction();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    focusedIndex,
    card.items,
    toggleItem,
    selectRange,
    checkAll,
    uncheckAll,
    executeBatchAction,
    submitRule,
  ]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openDropdownId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdownId]);

  // Capitalize action label for button
  const actionButtonLabel = `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} ${checkedCount}`;

  return (
    <div
      className={cn(
        "relative w-[640px] max-w-2xl bg-blue-950/20 border rounded-xl overflow-hidden transition-all duration-200 border-l-4",
        isActive
          ? "border-blue-400 shadow-lg shadow-blue-400/10 scale-100"
          : "border-blue-400/40 scale-95 opacity-60"
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-secondary/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">{card.title}</h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
              {totalCount} item{totalCount !== 1 ? "s" : ""}
            </span>
          </div>
          {batchType && (
            <span className="text-xs text-muted-foreground font-mono">
              {batchType}
            </span>
          )}
        </div>
        {explanation && (
          <p className="text-xs text-muted-foreground mt-1">{explanation}</p>
        )}
      </div>

      {/* Item list */}
      <div className="divide-y divide-border/50 max-h-[70vh] overflow-y-auto">
        {card.items.map((item, index) => {
          const isChecked = checkedIds.has(item.id);
          const isFocused = focusedIndex === index;
          const connectorConfig = CONNECTOR_ICON[item.connector] || CONNECTOR_ICON.manual;
          const ConnectorIcon = connectorConfig.icon;
          const tierConfig = TIER_CONFIG[item.tier];

          return (
            <div
              key={item.id}
              className={cn(
                "group flex items-start gap-2 px-4 py-2 cursor-pointer transition-colors",
                isFocused && isActive && "bg-blue-500/10",
                !isFocused && "hover:bg-secondary/50"
              )}
              onClick={() => toggleItem(item.id, index)}
            >
              {/* Checkbox */}
              <div className="shrink-0 mt-0.5">
                {isChecked ? (
                  <CheckSquare className="w-4 h-4 text-blue-400" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              {/* Connector icon */}
              <div className="shrink-0 mt-0.5">
                <ConnectorIcon
                  className={cn("w-3.5 h-3.5", connectorConfig.color)}
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground truncate">
                    {item.senderName || item.sender}
                  </span>
                  {tierConfig && (
                    <span
                      className={cn(
                        "px-1.5 py-0 rounded-full text-[10px] font-medium border shrink-0",
                        tierConfig.className
                      )}
                    >
                      {tierConfig.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground/80 truncate">
                  {item.subject}
                </p>
                {item.summary && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {item.summary}
                  </p>
                )}
              </div>

              {/* Reclassify button */}
              {onReclassify && (
                <div className="relative shrink-0" ref={openDropdownId === item.id ? dropdownRef : undefined}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdownId(
                        openDropdownId === item.id ? null : item.id
                      );
                    }}
                    className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
                    title="Move to different group"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </button>

                  {openDropdownId === item.id && (
                    <div className="absolute right-0 top-full mt-1 z-30 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                      {BATCH_TYPES.filter((bt) => bt.value !== batchType).map(
                        (bt) => (
                          <button
                            key={bt.value}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(null);
                              onReclassify(
                                item.id,
                                batchType,
                                bt.value,
                                item.sender,
                                item.senderName,
                                item.connector
                              );
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors"
                          >
                            {bt.label}
                          </button>
                        )
                      )}
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownId(null);
                          onReclassify(
                            item.id,
                            batchType,
                            "individual",
                            item.sender,
                            item.senderName,
                            item.connector
                          );
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        Remove from groups
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Rules learned section */}
      {rules && rules.length > 0 && (
        <div className="border-t border-border/50">
          <button
            onClick={() => setRulesExpanded(!rulesExpanded)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {rulesExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <Shield className="w-3.5 h-3.5" />
            <span>{rules.length} rule{rules.length !== 1 ? "s" : ""} learned</span>
          </button>

          {rulesExpanded && (
            <div className="px-4 pb-2 space-y-1">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground/80 truncate block">{rule.name}</span>
                    {rule.trigger?.sender && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        sender: {rule.trigger.sender}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px]">
                    {rule.matchCount > 0 ? `${rule.matchCount} matches` : "new"}
                  </span>
                  {onDeleteRule && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRule(rule.id);
                      }}
                      className="p-0.5 rounded text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                      title="Delete rule"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer: action button + rule input */}
      <div className="px-4 py-3 border-t border-border bg-secondary/50">
        <div className="flex items-center gap-3">
          <button
            onClick={executeBatchAction}
            disabled={checkedCount === 0}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              checkedCount > 0
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                : "bg-secondary text-muted-foreground border border-border cursor-not-allowed"
            )}
          >
            <Check className="w-3.5 h-3.5" />
            {actionButtonLabel}
          </button>

          {checkedCount < totalCount && (
            <button
              onClick={checkAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-secondary text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/80"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Select All
            </button>
          )}

          <div className="flex-1 relative">
            <input
              ref={ruleInputRef}
              type="text"
              value={ruleInput}
              onChange={(e) => setRuleInput(e.target.value)}
              placeholder="Add a rule, e.g. 'never auto-archive from...'"
              className="w-full px-3 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-400/50"
            />
            {ruleInput.trim() && (
              <button
                onClick={submitRule}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                <Send className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Keyboard hints (only when active) */}
        {isActive && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-2">
            <KeyHint keyName="j/k" label="Navigate" />
            <KeyHint keyName="Space" label="Toggle" />
            <KeyHint keyName="Shift+Space" label="Range" />
            <KeyHint keyName="a" label="All" />
            <KeyHint keyName="n" label="None" />
            <KeyHint keyName="←" label="Execute" />
          </div>
        )}
      </div>
    </div>
  );
}

function KeyHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
        {keyName}
      </kbd>
      <span>{label}</span>
    </div>
  );
}
