"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  PenLine,
  Save,
  RefreshCw,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/aurelius/app-shell";
import { MemoryBrowser } from "@/components/aurelius/memory-browser";

// --- Types ---

type MemoryItem = {
  entity: {
    id: string;
    name: string;
    type: string;
    summary: string | null;
  };
  facts: Array<{
    id: string;
    content: string;
    category: string | null;
    createdAt: Date;
  }>;
};

type MemoryClientProps = {
  initialMemory: MemoryItem[];
};

interface MemoryEvent {
  id: string;
  timestamp: string;
  eventType: "recall" | "extract" | "save" | "search" | "reindex" | "evaluate";
  trigger: "chat" | "heartbeat" | "triage" | "manual" | "api";
  triggerId: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  reasoning: Record<string, unknown> | null;
  evaluation: Record<string, unknown> | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
}

// --- Icon & Color Config ---

const EVENT_TYPE_CONFIG: Record<
  MemoryEvent["eventType"],
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    label: string;
  }
> = {
  recall: { icon: Search, color: "text-blue-400", label: "Recall" },
  search: { icon: Search, color: "text-blue-400", label: "Search" },
  extract: { icon: PenLine, color: "text-amber-400", label: "Extract" },
  save: { icon: Save, color: "text-green-400", label: "Save" },
  reindex: { icon: RefreshCw, color: "text-purple-400", label: "Reindex" },
  evaluate: { icon: FlaskConical, color: "text-pink-400", label: "Evaluate" },
};

const EVENT_TYPE_FILTERS = [
  "All",
  "Recall",
  "Extract",
  "Save",
  "Search",
  "Reindex",
  "Evaluate",
] as const;

const TRIGGER_FILTERS = [
  "All",
  "Chat",
  "Heartbeat",
  "Triage",
  "Manual",
  "Api",
] as const;

// --- Helpers ---

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const diff = today.getTime() - eventDay.getTime();
  const dayMs = 86400000;

  if (diff < dayMs) return "Today";
  if (diff < dayMs * 2) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function groupEventsByDay(
  events: MemoryEvent[]
): Array<{ label: string; events: MemoryEvent[] }> {
  const groups: Map<string, MemoryEvent[]> = new Map();

  for (const event of events) {
    const label = formatDayLabel(event.timestamp);
    const existing = groups.get(label);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(label, [event]);
    }
  }

  return Array.from(groups.entries()).map(([label, evts]) => ({
    label,
    events: evts,
  }));
}

// --- Feed Event Card ---

function FeedEventCard({ event }: { event: MemoryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_TYPE_CONFIG[event.eventType];
  const Icon = config.icon;
  const duration = formatDuration(event.durationMs);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={cn(
        "w-full text-left rounded-lg border transition-colors",
        "border border-border bg-card rounded-lg p-3",
        expanded ? "border-border" : "border-border/50 hover:border-border"
      )}
    >
      {/* Compact view */}
      <div className="flex items-start gap-3">
        <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", config.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {formatTime(event.timestamp)}
            </span>
            <span className={cn("text-xs font-medium", config.color)}>
              {config.label}
            </span>
            <span className="text-xs text-muted-foreground/70">
              via {event.trigger}
            </span>
            {duration && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto shrink-0">
                {duration}
              </span>
            )}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {event.summary}
          </p>
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-4 ml-7">
          {/* Full summary if truncated */}
          {event.summary.length > 80 && (
            <div>
              <h4 className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Summary
              </h4>
              <p className="text-sm text-foreground">{event.summary}</p>
            </div>
          )}

          {/* Trigger info */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-muted-foreground">Trigger: </span>
              <span className="text-xs font-medium">{event.trigger}</span>
            </div>
            {event.triggerId && (
              <div>
                <span className="text-xs text-muted-foreground">ID: </span>
                <span className="text-xs font-mono text-foreground">
                  {event.triggerId.length > 16
                    ? event.triggerId.slice(0, 16) + "..."
                    : event.triggerId}
                </span>
              </div>
            )}
            {duration && (
              <div>
                <span className="text-xs text-muted-foreground">
                  Duration:{" "}
                </span>
                <span className="text-xs font-medium">{duration}</span>
              </div>
            )}
          </div>

          {/* Payload */}
          {event.payload && Object.keys(event.payload).length > 0 && (
            <div>
              <h4 className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Payload
              </h4>
              <pre className="text-xs text-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          )}

          {/* Reasoning */}
          {event.reasoning && Object.keys(event.reasoning).length > 0 && (
            <div>
              <h4 className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Reasoning
              </h4>
              <pre className="text-xs text-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.reasoning, null, 2)}
              </pre>
            </div>
          )}

          {/* Evaluation */}
          {event.evaluation && Object.keys(event.evaluation).length > 0 && (
            <div>
              <h4 className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Evaluation
              </h4>
              <pre className="text-xs text-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.evaluation, null, 2)}
              </pre>
            </div>
          )}

          {/* Metadata */}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div>
              <h4 className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Metadata
              </h4>
              <pre className="text-xs text-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// --- Memory Feed Component ---

function MemoryFeed() {
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [triggerFilter, setTriggerFilter] = useState<string>("All");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/memory/events?limit=100");
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
      const data = await res.json();
      setEvents(
        (data.events || []).map((e: Record<string, unknown>) => ({
          ...e,
          timestamp:
            typeof e.timestamp === "string"
              ? e.timestamp
              : new Date(e.timestamp as number).toISOString(),
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Apply filters
  const filtered = events.filter((event) => {
    if (typeFilter !== "All" && event.eventType !== typeFilter.toLowerCase()) {
      return false;
    }
    if (
      triggerFilter !== "All" &&
      event.trigger !== triggerFilter.toLowerCase()
    ) {
      return false;
    }
    if (
      searchText.trim() &&
      !event.summary.toLowerCase().includes(searchText.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const grouped = groupEventsByDay(filtered);

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-col gap-3">
        {/* Search + Refresh */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search events..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-10 pr-3 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
            />
          </div>
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="px-3 py-2 rounded-md border border-border bg-background text-sm text-muted-foreground hover:text-foreground hover:border-gold/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw
              className={cn("w-4 h-4", loading && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        {/* Event type filters */}
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground self-center mr-1">
            Type:
          </span>
          {EVENT_TYPE_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                typeFilter === filter
                  ? "bg-gold/20 text-gold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Trigger filters */}
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground self-center mr-1">
            Trigger:
          </span>
          {TRIGGER_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => setTriggerFilter(filter)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                triggerFilter === filter
                  ? "bg-gold/20 text-gold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error / Empty states */}
      {loading && events.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading events...
          </span>
        </div>
      )}

      {error && (
        <div className="text-center py-8">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchEvents}
            className="mt-2 text-sm text-gold hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {events.length === 0
            ? "No memory events yet. Send a chat message or run heartbeat to see activity."
            : "No events match the current filters."}
        </div>
      )}

      {/* Grouped event list */}
      {grouped.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs text-muted-foreground uppercase tracking-wide mb-2 mt-4 first:mt-0">
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.events.map((event) => (
              <FeedEventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}

      {/* Count */}
      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          Showing {filtered.length} of {events.length} events
        </p>
      )}
    </div>
  );
}

// --- Tab Config ---

type TabId = "entities" | "debug-feed";

const TABS: Array<{ id: TabId; label: string; subtitle: string }> = [
  {
    id: "entities",
    label: "Entities",
    subtitle: "Browse and search the knowledge graph",
  },
  {
    id: "debug-feed",
    label: "Debug Feed",
    subtitle: "Track memory operations and debug extraction quality",
  },
];

// --- Main Component ---

export function MemoryClient({ initialMemory }: MemoryClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>("entities");
  const currentTab = TABS.find((t) => t.id === activeTab)!;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">Memory</h1>
          <p className="text-sm text-muted-foreground">
            {currentTab.subtitle}
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "text-gold border-b-2 border-gold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">
          {activeTab === "entities" && (
            <MemoryBrowser initialMemory={initialMemory} />
          )}
          {activeTab === "debug-feed" && <MemoryFeed />}
        </div>
      </div>
    </AppShell>
  );
}
