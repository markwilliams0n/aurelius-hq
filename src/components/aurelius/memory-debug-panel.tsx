"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  Search,
  PenLine,
  Save,
  RefreshCw,
  FlaskConical,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemoryDebug } from "./memory-debug-provider";
import Link from "next/link";

// --- Types ---

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

interface MemoryDebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
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

// --- Helpers ---

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- Value Renderer ---

function RenderValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">none</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className={value ? "text-green-400" : "text-red-400"}>
        {value ? "yes" : "no"}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="text-blue-300">{value}</span>;
  }

  if (typeof value === "string") {
    // Truncate long strings
    if (value.length > 200) {
      return <span className="text-foreground">{value.slice(0, 200)}...</span>;
    }
    return <span className="text-foreground">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground italic">empty</span>;
    }
    return (
      <ul className="space-y-0.5 pl-3 border-l border-border/50">
        {value.map((item, i) => (
          <li key={i} className="text-xs">
            <RenderValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground italic">empty</span>;
    }
    // Prevent deeply nested rendering
    if (depth >= 3) {
      return (
        <span className="text-muted-foreground italic">
          {JSON.stringify(value).slice(0, 100)}...
        </span>
      );
    }
    return (
      <div className="space-y-1 pl-3 border-l border-border/50">
        {entries.map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground text-xs">{k}: </span>
            <RenderValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-foreground">{String(value)}</span>;
}

// --- Evaluation Section ---

function EvaluationSection({
  evaluation,
}: {
  evaluation: Record<string, unknown>;
}) {
  const score = evaluation.score as number | undefined;
  const missed = evaluation.missed as string[] | undefined;
  const weak = evaluation.weak as string[] | undefined;
  const good = evaluation.good as string[] | undefined;
  const suggestions = evaluation.suggestions as string[] | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Evaluation
        </span>
        {score !== undefined && (
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-bold",
              score >= 4
                ? "bg-green-500/20 text-green-400"
                : score >= 3
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-red-500/20 text-red-400"
            )}
          >
            {score}/5
          </span>
        )}
      </div>

      {good && good.length > 0 && (
        <div>
          <span className="text-xs text-green-400">Good:</span>
          <ul className="pl-3 space-y-0.5">
            {good.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {weak && weak.length > 0 && (
        <div>
          <span className="text-xs text-amber-400">Weak:</span>
          <ul className="pl-3 space-y-0.5">
            {weak.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missed && missed.length > 0 && (
        <div>
          <span className="text-xs text-red-400">Missed:</span>
          <ul className="pl-3 space-y-0.5">
            {missed.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div>
          <span className="text-xs text-blue-400">Suggestions:</span>
          <ul className="pl-3 space-y-0.5">
            {suggestions.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Render any extra keys not covered above */}
      {Object.entries(evaluation)
        .filter(
          ([k]) =>
            !["score", "missed", "weak", "good", "suggestions"].includes(k)
        )
        .map(([k, v]) => (
          <div key={k}>
            <span className="text-xs text-muted-foreground">{k}: </span>
            <RenderValue value={v} />
          </div>
        ))}
    </div>
  );
}

// --- Event Card ---

function EventCard({ event }: { event: MemoryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_TYPE_CONFIG[event.eventType];
  const Icon = config.icon;
  const duration = formatDuration(event.durationMs);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={cn(
        "w-full text-left rounded-lg border transition-colors",
        expanded
          ? "bg-card border-border"
          : "bg-card/50 border-border/50 hover:bg-card hover:border-border"
      )}
    >
      {/* Compact view */}
      <div className="px-3 py-2 flex items-start gap-2">
        <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", config.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {formatTime(event.timestamp)}
            </span>
            <span className="text-xs font-medium">{config.label}</span>
            {duration && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto shrink-0">
                {duration}
              </span>
            )}
            {expanded ? (
              <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {event.summary}
          </p>
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-3">
          {/* Summary (full, not truncated) */}
          {event.summary.length > 60 && (
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Summary
              </span>
              <p className="text-xs text-foreground mt-0.5">{event.summary}</p>
            </div>
          )}

          {/* Trigger info */}
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <span className="text-xs text-muted-foreground">Trigger: </span>
              <span className="text-xs font-medium">{event.trigger}</span>
            </div>
            {event.triggerId && (
              <div>
                <span className="text-xs text-muted-foreground">ID: </span>
                <span className="text-xs font-mono text-foreground">
                  {event.triggerId.length > 12
                    ? event.triggerId.slice(0, 12) + "..."
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
          {event.payload &&
            Object.keys(event.payload).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Payload
                </span>
                <div className="mt-1 text-xs">
                  {Object.entries(event.payload).map(([k, v]) => (
                    <div key={k} className="mb-1">
                      <span className="text-muted-foreground">{k}: </span>
                      <RenderValue value={v} />
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Reasoning */}
          {event.reasoning &&
            Object.keys(event.reasoning).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Reasoning
                </span>
                <div className="mt-1 text-xs">
                  {Object.entries(event.reasoning).map(([k, v]) => (
                    <div key={k} className="mb-1">
                      <span className="text-muted-foreground">{k}: </span>
                      <RenderValue value={v} />
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Evaluation */}
          {event.evaluation &&
            Object.keys(event.evaluation).length > 0 && (
              <EvaluationSection evaluation={event.evaluation} />
            )}

          {/* Metadata */}
          {event.metadata &&
            Object.keys(event.metadata).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Metadata
                </span>
                <div className="mt-1 text-xs">
                  {Object.entries(event.metadata).map(([k, v]) => (
                    <div key={k} className="mb-1">
                      <span className="text-muted-foreground">{k}: </span>
                      <RenderValue value={v} />
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}
    </button>
  );
}

// --- Main Panel ---

export function MemoryDebugPanel({ isOpen, onClose }: MemoryDebugPanelProps) {
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { debugMode, setDebugMode } = useMemoryDebug();

  const connectSSE = useCallback(async () => {
    // Clean up any existing connection
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/memory/events/stream", {
        signal: abort.signal,
      });

      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (part.startsWith(": ")) continue; // heartbeat comment
          const dataLine = part.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine);

            if (data.type === "init" && Array.isArray(data.events)) {
              setEvents(
                data.events.map((e: Record<string, unknown>) => ({
                  ...e,
                  timestamp:
                    typeof e.timestamp === "string"
                      ? e.timestamp
                      : new Date(e.timestamp as number).toISOString(),
                }))
              );
            } else if (data.type === "event" && data.event) {
              const evt = data.event as Record<string, unknown>;
              setEvents((prev) => {
                const updated = [
                  {
                    ...(evt as unknown as MemoryEvent),
                    timestamp:
                      typeof evt.timestamp === "string"
                        ? evt.timestamp
                        : new Date(evt.timestamp as number).toISOString(),
                  },
                  ...prev,
                ];
                return updated.length > 200 ? updated.slice(0, 200) : updated;
              });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      // AbortError is expected on cleanup
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[MemoryDebugPanel] SSE connection error:", err);
    }

    // Stream ended or errored — reconnect after 3s if panel is still open
    if (!abortRef.current?.signal.aborted) {
      reconnectTimerRef.current = setTimeout(() => {
        connectSSE();
      }, 3000);
    }
  }, []);

  const disconnectSSE = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
  }, []);

  // Connect/disconnect based on isOpen
  useEffect(() => {
    if (isOpen) {
      connectSSE();
    } else {
      disconnectSSE();
    }

    return () => {
      disconnectSSE();
    };
  }, [isOpen, connectSSE, disconnectSSE]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-[28rem] h-full bg-background border-l border-border flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="font-serif text-lg text-gold">Memory Debug</h2>

          <div className="flex items-center gap-2">
            {/* Debug mode toggle */}
            <button
              onClick={() => setDebugMode(!debugMode)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                debugMode
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-muted text-muted-foreground border-border hover:text-foreground"
              )}
            >
              Debug: {debugMode ? "ON" : "OFF"}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {events.length === 0 ? (
            <div className="flex items-center justify-center h-full px-4">
              <p className="text-sm text-muted-foreground text-center">
                No memory events yet. Send a chat message or run heartbeat to
                see activity.
              </p>
            </div>
          ) : (
            events.map((event) => <EventCard key={event.id} event={event} />)
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          <Link
            href="/memory"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gold transition-colors"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
