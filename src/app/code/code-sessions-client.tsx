"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import { toast } from "sonner";
import { Code, RefreshCw, Loader2, Terminal } from "lucide-react";
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
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleCardAction = useCallback(
    async (
      cardId: string,
      actionName: string,
      editedData?: Record<string, unknown>,
    ) => {
      try {
        const response = await fetch(`/api/action-card/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: editedData }),
        });
        if (!response.ok) throw new Error("Action failed");
        const result = await response.json();

        if (result.status === "needs_confirmation") {
          if (confirm(result.confirmMessage || "Are you sure?")) {
            return handleCardAction(cardId, actionName, {
              ...editedData,
              _confirmed: true,
            });
          }
          return;
        }

        if (result.status === "confirmed") {
          toast.success(result.successMessage || "Done!");
        } else if (result.status === "dismissed") {
          toast.success("Dismissed");
        } else if (result.status === "error") {
          toast.error(result.result?.error || "Action failed");
        }

        // Refresh the list after any action
        fetchCards();
      } catch {
        toast.error("Action failed");
      }
    },
    [fetchCards],
  );

  const updateCardData = useCallback(
    (cardId: string, newData: Record<string, unknown>) => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, data: newData } : c)),
      );
    },
    [],
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
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-3xl mx-auto">
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
                  Ask Aurelius to fix a bug or add a feature in chat — coding
                  sessions will appear here.
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
                        {groups[group].map((card) => (
                          <div key={card.id}>
                            <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground/60">
                              <span>{timeAgo(card.createdAt ?? "")}</span>
                            </div>
                            <ActionCard
                              card={card}
                              onAction={(action, editedData) =>
                                handleCardAction(
                                  card.id,
                                  action,
                                  editedData ?? card.data,
                                )
                              }
                            >
                              <CardContent
                                card={card}
                                onDataChange={(newData) =>
                                  updateCardData(card.id, newData)
                                }
                                onAction={(action, data) =>
                                  handleCardAction(
                                    card.id,
                                    action,
                                    data ?? card.data,
                                  )
                                }
                              />
                            </ActionCard>
                          </div>
                        ))}
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
