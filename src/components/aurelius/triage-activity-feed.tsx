"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Archive,
  Eye,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Settings2,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ClassificationData {
  recommendation?: string;
  confidence?: number;
  reasoning?: string;
  actualAction?: string;
  wasOverride?: boolean;
  triagePath?: string;
  classifiedAt?: string;
}

interface ActivityItem {
  id: string;
  sender: string;
  senderName: string | null;
  subject: string;
  status: string;
  classification: ClassificationData | null;
  createdAt: string;
  updatedAt: string;
}

interface ActivityBatch {
  date: string;
  label: string;
  items: ActivityItem[];
  stats: {
    total: number;
    archived: number;
    review: number;
    attention: number;
    overrides: number;
  };
}

function groupIntoBatches(items: ActivityItem[]): ActivityBatch[] {
  const groups = new Map<string, ActivityItem[]>();

  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = `${date.toLocaleDateString()} ${date.getHours() < 12 ? "AM" : "PM"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return Array.from(groups.entries()).map(([label, items]) => {
    const stats = {
      total: items.length,
      archived: items.filter(
        (i) => i.classification?.recommendation === "archive"
      ).length,
      review: items.filter(
        (i) => i.classification?.recommendation === "review"
      ).length,
      attention: items.filter(
        (i) => i.classification?.recommendation === "attention"
      ).length,
      overrides: items.filter((i) => i.classification?.wasOverride).length,
    };
    return { date: items[0].createdAt, label, items, stats };
  });
}

function getRecommendationIcon(rec?: string) {
  switch (rec) {
    case "archive":
      return <Archive className="w-3.5 h-3.5 text-green-400" />;
    case "review":
      return <Eye className="w-3.5 h-3.5 text-gold" />;
    case "attention":
      return <AlertCircle className="w-3.5 h-3.5 text-orange-400" />;
    default:
      return null;
  }
}

interface ActivityFeedProps {
  onOpenRulesPanel: () => void;
  onCreateRule: (input: string) => void;
}

export function TriageActivityFeed({
  onOpenRulesPanel,
  onCreateRule,
}: ActivityFeedProps) {
  const { data } = useSWR("/api/triage/activity?limit=100", fetcher, {
    refreshInterval: 30000,
  });
  const [ruleInput, setRuleInput] = useState("");
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(
    new Set()
  );

  const batches = useMemo(() => {
    if (!data?.items) return [];
    return groupIntoBatches(data.items);
  }, [data?.items]);

  const toggleBatch = (label: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleSubmitRule = () => {
    if (!ruleInput.trim()) return;
    onCreateRule(ruleInput.trim());
    setRuleInput("");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Activity Feed</h2>
        </div>
        <button
          onClick={onOpenRulesPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Manage Rules
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {batches.map((batch) => {
          const isExpanded =
            expandedBatches.has(batch.label) || batches.length <= 2;
          return (
            <div key={batch.label}>
              <button
                onClick={() => toggleBatch(batch.label)}
                className="w-full flex items-center justify-between mb-2 group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {batch.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {batch.stats.total} classified
                    {batch.stats.overrides > 0 &&
                      `, ${batch.stats.overrides} overrides`}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-1">
                  {batch.items.map((item) => (
                    <ActivityEntry key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {batches.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            No classification activity yet.
          </div>
        )}
      </div>

      <div className="border-t border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ruleInput}
            onChange={(e) => setRuleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmitRule();
              }
            }}
            placeholder='Type a rule... e.g. "always archive from zapier"'
            className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleSubmitRule}
            disabled={!ruleInput.trim()}
            className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const c = item.classification;
  const isOverride = c?.wasOverride;
  const displayName = item.senderName || item.sender;

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-lg text-sm",
        isOverride && "bg-orange-500/5 border border-orange-500/10"
      )}
    >
      <div className="pt-0.5">{getRecommendationIcon(c?.recommendation)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground truncate">
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {item.subject}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {isOverride && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400">
              <AlertTriangle className="w-3 h-3" />
              Override — suggested {c?.recommendation}, you {c?.actualAction}
            </span>
          )}
          {!isOverride && c?.reasoning && (
            <span className="text-[10px] text-muted-foreground/70 line-clamp-1">
              {c.reasoning}
            </span>
          )}
          {c?.confidence != null && (
            <span className="text-[10px] text-muted-foreground/50">
              {Math.round(c.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
