"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Inbox,
  Archive,
  Clock,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  Trash2,
  RotateCcw,
  Mail,
  MessageSquare,
  LayoutList,
  CalendarDays,
  Loader2,
  CheckCheck,
  XCircle,
  FileText,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RightSidebar } from "./right-sidebar";

interface TriageSidebarProps {
  stats: {
    new: number;
    archived: number;
    snoozed: number;
    actioned: number;
  };
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onUndo?: (activityId: string, action: string, itemId: string) => void;
}

type ActivityItem = {
  id: string;
  eventType: string;
  actor: string;
  description: string;
  metadata: {
    action?: string;
    itemId?: string;
    connector?: string;
    subject?: string;
    sender?: string;
    status?: string;
    factsCount?: number;
    facts?: string[];
    error?: string;
    durationMs?: number;
    previousStatus?: string;
    newStatus?: string;
    snoozeUntil?: string;
  } | null;
  createdAt: string;
};

export function TriageSidebar({ stats, isExpanded = false, onToggleExpand, onUndo }: TriageSidebarProps) {
  const [activeTab, setActiveTab] = useState<"activity" | "notes">("activity");
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [dailyNotes, setDailyNotes] = useState<string>("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Fetch activities
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?eventType=triage_action&limit=30");
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error("Failed to fetch activities:", error);
    }
  }, []);

  // Fetch daily notes
  const fetchDailyNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/daily-notes");
      if (res.ok) {
        const data = await res.json();
        setDailyNotes(data.content || "No notes yet today.");
      }
    } catch (error) {
      console.error("Failed to fetch daily notes:", error);
      setDailyNotes("Failed to load notes.");
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    if (activeTab === "activity") {
      fetchActivities();
      // Poll every 3 seconds for activity updates (to catch background memory completion)
      const interval = setInterval(fetchActivities, 3000);
      return () => clearInterval(interval);
    } else {
      fetchDailyNotes();
    }
  }, [activeTab, fetchActivities, fetchDailyNotes]);

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleUndo = async (activity: ActivityItem) => {
    if (!activity.metadata?.itemId || !activity.metadata?.action) return;

    if (onUndo) {
      onUndo(activity.id, activity.metadata.action, activity.metadata.itemId);
    } else {
      // Default undo: restore the item
      try {
        await fetch(`/api/triage/${activity.metadata.itemId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        fetchActivities();
      } catch (error) {
        console.error("Failed to undo:", error);
      }
    }
  };

  return (
    <RightSidebar
      title="Inbox Stats"
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
    >
      {/* Stats section */}
      <div className="px-4 py-3 border-b border-border">
        <div className="grid grid-cols-2 gap-2">
          <StatBadge icon={Inbox} label="New" value={stats.new} color="text-gold" />
          <StatBadge icon={Archive} label="Archived" value={stats.archived} color="text-muted-foreground" />
          <StatBadge icon={Clock} label="Snoozed" value={stats.snoozed} color="text-blue-400" />
          <StatBadge icon={CheckCircle} label="Done" value={stats.actioned} color="text-green-400" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("activity")}
          className={cn(
            "flex-1 px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "activity"
              ? "text-gold border-b-2 border-gold"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab("notes")}
          className={cn(
            "flex-1 px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "notes"
              ? "text-gold border-b-2 border-gold"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Notes
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "activity" ? (
          <ActivityList
            activities={activities}
            expandedItems={expandedItems}
            onToggleExpanded={toggleExpanded}
            onUndo={handleUndo}
            onRefresh={fetchActivities}
          />
        ) : (
          <DailyNotesView content={dailyNotes} onRefresh={fetchDailyNotes} />
        )}
      </div>
    </RightSidebar>
  );
}

function StatBadge({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
      <Icon className={cn("w-4 h-4", color)} />
      <div className="flex flex-col">
        <span className="font-mono text-sm font-medium">{value}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// Activity list component
function ActivityList({
  activities,
  expandedItems,
  onToggleExpanded,
  onUndo,
  onRefresh,
}: {
  activities: ActivityItem[];
  expandedItems: Set<string>;
  onToggleExpanded: (id: string) => void;
  onUndo: (activity: ActivityItem) => void;
  onRefresh: () => void;
}) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <Clock className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  const connectorIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    gmail: Mail,
    slack: MessageSquare,
    linear: LayoutList,
    granola: CalendarDays,
  };

  const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    archive: Archive,
    memory: Brain,
    snooze: Clock,
    spam: Trash2,
    restore: RotateCcw,
    actioned: CheckCircle,
  };

  const statusColors: Record<string, string> = {
    processing: "text-yellow-400",
    completed: "text-green-400",
    failed: "text-red-400",
  };

  return (
    <div className="divide-y divide-border">
      <div className="px-4 py-2 flex justify-end">
        <button
          onClick={onRefresh}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
      {activities.map((activity) => {
        const isExpanded = expandedItems.has(activity.id);
        const action = activity.metadata?.action || "action";
        const connector = activity.metadata?.connector || "manual";
        const status = activity.metadata?.status;
        const ConnectorIcon = connectorIcons[connector] || Mail;
        const ActionIcon = actionIcons[action] || CheckCircle;
        const canUndo = ["archive", "spam", "snooze", "actioned"].includes(action) && status !== "processing";

        return (
          <div key={activity.id} className="px-4 py-2">
            <div
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => onToggleExpanded(activity.id)}
            >
              {/* Expand indicator */}
              <button className="mt-0.5 text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>

              {/* Action icon */}
              <div className="mt-0.5">
                {status === "processing" ? (
                  <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                ) : status === "completed" ? (
                  <CheckCheck className="w-4 h-4 text-green-400" />
                ) : status === "failed" ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : (
                  <ActionIcon className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{activity.description}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <ConnectorIcon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimeAgo(new Date(activity.createdAt))}
                  </span>
                  {status && (
                    <span className={cn("text-[10px]", statusColors[status] || "text-muted-foreground")}>
                      {status}
                    </span>
                  )}
                </div>
              </div>

              {/* Undo button */}
              {canUndo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUndo(activity);
                  }}
                  className="text-xs text-muted-foreground hover:text-gold px-2 py-1 rounded hover:bg-secondary"
                >
                  Undo
                </button>
              )}
            </div>

            {/* Expanded details */}
            {isExpanded && activity.metadata && (
              <div className="ml-7 mt-2 p-2 rounded-lg bg-secondary/50 text-xs space-y-1.5">
                {/* Facts - show prominently */}
                {activity.metadata.facts && activity.metadata.facts.length > 0 && (
                  <div className="space-y-1.5">
                    {activity.metadata.facts.map((fact, i) => (
                      <div key={i} className="pl-2 border-l-2 border-gold/50 text-foreground">
                        {fact}
                      </div>
                    ))}
                  </div>
                )}
                {/* Error message */}
                {activity.metadata.error && (
                  <div className="text-red-400 text-[10px]">
                    Error: {activity.metadata.error}
                  </div>
                )}
                {/* Snooze until */}
                {activity.metadata.snoozeUntil && (
                  <div className="text-muted-foreground text-[10px]">
                    Until: {new Date(activity.metadata.snoozeUntil).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Daily notes view component
function DailyNotesView({ content, onRefresh }: { content: string; onRefresh: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gold" />
          <h4 className="text-sm font-medium">Today's Notes</h4>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <div className="text-xs text-muted-foreground whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

// Format time ago helper
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
