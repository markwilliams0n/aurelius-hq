"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import { Code, RefreshCw, Loader2, Terminal, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionCardData } from "@/lib/types/action-card";
import { cn } from "@/lib/utils";

type SessionGroup = "active" | "completed" | "failed";

function classifyCard(card: ActionCardData): SessionGroup {
  if (card.status === "error") return "failed";
  if (card.status === "confirmed") {
    // "confirmed" with a result means session finished; without means running
    const data = card.data as Record<string, unknown>;
    return data.result ? "completed" : "active";
  }
  // pending = waiting for user to start
  return "active";
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const GROUP_META: Record<SessionGroup, { label: string; dotClass: string }> = {
  active: { label: "Active", dotClass: "bg-amber-400 animate-pulse" },
  completed: { label: "Completed", dotClass: "bg-green-500" },
  failed: { label: "Failed", dotClass: "bg-red-500" },
};

export function CodeSessionsClient() {
  const router = useRouter();
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const fetchCards = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      const res = await fetch("/api/action-cards/by-pattern?pattern=code");
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards ?? []);
      } else {
        toast.error("Failed to load coding sessions");
      }
    } catch {
      toast.error("Failed to load coding sessions");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
    // Poll for updates while sessions may be running
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchCards();
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchCards]);

  const handleCreateSession = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTask.trim()) return;
      setIsCreating(true);
      try {
        const res = await fetch("/api/code-sessions/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: newTask.trim() }),
        });
        if (!res.ok) throw new Error("Failed to create session");
        const { card } = await res.json();
        setNewTask("");
        setShowNewForm(false);
        router.push(`/code/${card.id}`);
      } catch {
        toast.error("Failed to create session");
      } finally {
        setIsCreating(false);
      }
    },
    [newTask, router],
  );

  // Group cards by status
  const groups: Record<SessionGroup, ActionCardData[]> = {
    active: [],
    completed: [],
    failed: [],
  };
  for (const card of cards) {
    groups[classifyCard(card)].push(card);
  }

  const groupOrder: SessionGroup[] = ["active", "completed", "failed"];
  const nonEmptyGroups = groupOrder.filter((g) => groups[g].length > 0);

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Code className="w-5 h-5 text-gold" />
              <h1 className="font-serif text-xl">Coding Sessions</h1>
              {cards.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  ({cards.length})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchCards(true)}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={cn("w-4 h-4", isRefreshing && "animate-spin")}
                />
              </Button>
              <Button
                size="sm"
                onClick={() => setShowNewForm((v) => !v)}
                className="bg-gold/90 hover:bg-gold text-black"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Session
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-3xl mx-auto">
            {/* New session form */}
            {showNewForm && (
              <form
                onSubmit={handleCreateSession}
                className="mb-6 border border-border rounded-lg p-4 bg-muted/20"
              >
                <label className="block text-sm font-medium text-foreground mb-2">
                  What should Aurelius code?
                </label>
                <input
                  type="text"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  placeholder="e.g. Fix the login validation bug, Add dark mode toggle..."
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                  autoFocus
                  disabled={isCreating}
                />
                <div className="flex gap-2 mt-3">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newTask.trim() || isCreating}
                    className="bg-green-600 hover:bg-green-500 text-white"
                  >
                    {isCreating ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Plus className="w-3 h-3 mr-1" />
                    )}
                    Create Session
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowNewForm(false);
                      setNewTask("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && cards.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Terminal className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <h2 className="text-lg font-medium text-muted-foreground mb-1">
                  No coding sessions yet
                </h2>
                <p className="text-sm text-muted-foreground/70">
                  Click &quot;New Session&quot; above or ask Aurelius in chat to start coding.
                </p>
              </div>
            )}

            {!isLoading && nonEmptyGroups.length > 0 && (
              <div className="space-y-8">
                {nonEmptyGroups.map((group) => {
                  const meta = GROUP_META[group];
                  return (
                    <div key={group}>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className={cn(
                            "inline-block w-2 h-2 rounded-full",
                            meta.dotClass,
                          )}
                        />
                        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                          {meta.label}
                        </h2>
                        <span className="text-xs text-muted-foreground/60">
                          ({groups[group].length})
                        </span>
                      </div>

                      <div className="space-y-2">
                        {groups[group].map((card) => {
                          const data = card.data as Record<string, unknown>;
                          const task = (data.task as string) || card.title;
                          const branch = data.branchName as string | undefined;
                          const statusLabel =
                            card.status === "error"
                              ? "Failed"
                              : card.status === "confirmed"
                                ? data.result
                                  ? "Completed"
                                  : "Running"
                                : "Pending";
                          const statusColor =
                            card.status === "error"
                              ? "text-red-400"
                              : card.status === "confirmed" && data.result
                                ? "text-green-400"
                                : "text-amber-400";

                          return (
                            <Link
                              key={card.id}
                              href={`/code/${card.id}`}
                              className="block border border-border rounded-lg p-4 hover:border-gold/30 hover:bg-muted/20 transition-colors group"
                            >
                              <div className="flex items-center justify-between">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground truncate group-hover:text-gold transition-colors">
                                    {task}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span
                                      className={cn(
                                        "text-xs font-medium",
                                        statusColor,
                                      )}
                                    >
                                      {statusLabel}
                                    </span>
                                    {branch && (
                                      <code className="text-xs text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded font-mono truncate max-w-48">
                                        {branch}
                                      </code>
                                    )}
                                    <span className="text-xs text-muted-foreground/50">
                                      {timeAgo(card.createdAt ?? "")}
                                    </span>
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-gold/60 transition-colors shrink-0 ml-3" />
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
