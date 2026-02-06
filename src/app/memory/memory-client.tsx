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
  ChevronLeft,
  ChevronRight,
  Loader2,
  Database,
  User,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/aurelius/app-shell";

// ============================================================
// Types
// ============================================================

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

interface OverviewData {
  stats: { totalMemories: number; totalPages: number };
  profile: { static: string[]; dynamic: string[] };
}

interface MemoryItem {
  id: string;
  title: string | null;
  type: string;
  status: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  containerTags: string[];
  content?: string;
}

interface MemoriesData {
  memories: MemoryItem[];
  pagination: {
    currentPage: number;
    totalItems: number;
    totalPages: number;
    limit: number;
  };
}

interface SearchResult {
  documentId: string;
  chunks: Array<{ content: string; score: number; isRelevant: boolean }>;
  score: number;
  title: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================================
// Debug Feed: Icon & Color Config
// ============================================================

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

// ============================================================
// Debug Feed: Helpers
// ============================================================

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

// ============================================================
// Memories Tab: Helpers
// ============================================================

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "bg-green-500/20 text-green-400";
    case "failed":
      return "bg-red-500/20 text-red-400";
    case "queued":
    case "extracting":
    case "chunking":
    case "embedding":
    case "indexing":
      return "bg-amber-500/20 text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ============================================================
// Debug Feed: FeedEventCard
// ============================================================

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

// ============================================================
// Debug Feed: MemoryFeed Component
// ============================================================

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

// ============================================================
// Overview Tab
// ============================================================

function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/memory/supermemory?view=overview");
      if (!res.ok) throw new Error(`Failed to fetch overview: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load overview"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading overview...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchOverview}
          className="mt-2 text-sm text-gold hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Stats card */}
      <div className="border border-border bg-card rounded-lg p-5">
        <div className="flex items-center gap-3 mb-1">
          <Database className="w-5 h-5 text-gold" />
          <h2 className="font-serif text-lg text-foreground">Stats</h2>
        </div>
        <div className="ml-8 mt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-gold tabular-nums">
              {data.stats.totalMemories}
            </span>
            <span className="text-sm text-muted-foreground">
              total memories
            </span>
          </div>
        </div>
      </div>

      {/* Profile: What I Know */}
      <div className="border border-border bg-card rounded-lg p-5">
        <div className="flex items-center gap-3 mb-3">
          <User className="w-5 h-5 text-gold" />
          <h2 className="font-serif text-lg text-foreground">What I Know</h2>
        </div>
        {data.profile.static.length === 0 ? (
          <p className="ml-8 text-sm text-muted-foreground">
            No static profile facts yet.
          </p>
        ) : (
          <ul className="ml-8 space-y-1.5">
            {data.profile.static.map((fact, i) => (
              <li key={i} className="text-sm text-foreground flex gap-2">
                <span className="text-gold shrink-0 mt-1">&bull;</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Profile: Recent Context */}
      <div className="border border-border bg-card rounded-lg p-5">
        <div className="flex items-center gap-3 mb-3">
          <Clock className="w-5 h-5 text-gold" />
          <h2 className="font-serif text-lg text-foreground">
            Recent Context
          </h2>
        </div>
        {data.profile.dynamic.length === 0 ? (
          <p className="ml-8 text-sm text-muted-foreground">
            No dynamic context yet.
          </p>
        ) : (
          <ul className="ml-8 space-y-1.5">
            {data.profile.dynamic.map((fact, i) => (
              <li key={i} className="text-sm text-foreground flex gap-2">
                <span className="text-gold shrink-0 mt-1">&bull;</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Memories Tab
// ============================================================

function MemoriesTab() {
  const [memoriesData, setMemoriesData] = useState<MemoriesData | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/memory/supermemory?view=memories&page=${pageNum}`
      );
      if (!res.ok) throw new Error(`Failed to fetch memories: ${res.status}`);
      const json = await res.json();
      setMemoriesData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load memories"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults(null);
        setActiveSearch("");
        return; // useEffect handles re-fetching when activeSearch clears
      }
      setLoading(true);
      setError(null);
      setActiveSearch(query);
      try {
        const res = await fetch(
          `/api/memory/search?q=${encodeURIComponent(query)}`
        );
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const json = await res.json();
        setSearchResults(json.results || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!activeSearch) {
      fetchMemories(page);
    }
  }, [page, activeSearch, fetchMemories]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch(searchQuery);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
    setActiveSearch("");
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search memories... (press Enter)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full pl-10 pr-3 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
        />
      </div>

      {/* Active search indicator */}
      {activeSearch && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Search results for &ldquo;{activeSearch}&rdquo;
          </span>
          <button
            onClick={clearSearch}
            className="text-xs text-gold hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            {activeSearch ? "Searching..." : "Loading memories..."}
          </span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="text-center py-8">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => activeSearch ? handleSearch(activeSearch) : fetchMemories(page)}
            className="mt-2 text-sm text-gold hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Search results view */}
      {!loading && !error && searchResults !== null && (
        <>
          {searchResults.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No results found for &ldquo;{activeSearch}&rdquo;
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((result) => {
                const bestChunk = result.chunks?.find((c) => c.isRelevant) ?? result.chunks?.[0];
                return (
                  <div
                    key={result.documentId}
                    className="border border-border/50 bg-card rounded-lg p-4 hover:border-border transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {result.title && (
                          <h3 className="text-sm font-medium text-foreground truncate mb-1">
                            {result.title}
                          </h3>
                        )}
                        <p className="text-sm text-muted-foreground line-clamp-3">
                          {bestChunk?.content ?? "No content"}
                        </p>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        {(result.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeDate(result.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Memory list view */}
      {!loading && !error && searchResults === null && memoriesData && (
        <>
          {memoriesData.memories.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No memories stored yet.
            </div>
          ) : (
            <div className="space-y-2">
              {memoriesData.memories.map((memory) => (
                <div
                  key={memory.id}
                  className="border border-border/50 bg-card rounded-lg p-4 hover:border-border transition-colors"
                >
                  {/* Title + badges row */}
                  <div className="flex items-start gap-2">
                    <h3 className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                      {memory.title ||
                        (memory.content
                          ? memory.content.slice(0, 60) + "..."
                          : "Untitled")}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {memory.type}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded",
                          statusColor(memory.status)
                        )}
                      >
                        {memory.status}
                      </span>
                    </div>
                  </div>

                  {/* Summary */}
                  {memory.summary && (
                    <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
                      {memory.summary.length > 150
                        ? memory.summary.slice(0, 150) + "..."
                        : memory.summary}
                    </p>
                  )}

                  {/* Date */}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeDate(memory.createdAt)}
                    </span>
                    {memory.containerTags.length > 0 && (
                      <div className="flex gap-1">
                        {memory.containerTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold/80"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {memoriesData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm text-muted-foreground hover:text-foreground hover:border-gold/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {memoriesData.pagination.currentPage} of{" "}
                {memoriesData.pagination.totalPages}
              </span>
              <button
                onClick={() =>
                  setPage((p) =>
                    Math.min(memoriesData.pagination.totalPages, p + 1)
                  )
                }
                disabled={page >= memoriesData.pagination.totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm text-muted-foreground hover:text-foreground hover:border-gold/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Tab Config
// ============================================================

type TabId = "overview" | "memories" | "debug-feed";

const TABS: Array<{ id: TabId; label: string; subtitle: string }> = [
  {
    id: "overview",
    label: "Overview",
    subtitle: "Memory stats and profile knowledge",
  },
  {
    id: "memories",
    label: "Memories",
    subtitle: "Browse and search stored memories",
  },
  {
    id: "debug-feed",
    label: "Debug Feed",
    subtitle: "Track memory operations and debug extraction quality",
  },
];

// ============================================================
// Main Component
// ============================================================

export function MemoryClient() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
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
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "memories" && <MemoriesTab />}
          {activeTab === "debug-feed" && <MemoryFeed />}
        </div>
      </div>
    </AppShell>
  );
}
