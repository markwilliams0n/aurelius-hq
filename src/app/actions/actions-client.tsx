"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/aurelius/app-shell";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import { toast } from "sonner";
import {
  Bell,
  RefreshCw,
  MessageSquare,
  Loader2,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionCardData } from "@/lib/types/action-card";
import { cn } from "@/lib/utils";

/** Group cards by conversationId, preserving order (newest conversation first). */
function groupByConversation(cards: ActionCardData[]) {
  const groups = new Map<string, ActionCardData[]>();
  for (const card of cards) {
    const key = card.conversationId ?? "unknown";
    const existing = groups.get(key);
    if (existing) {
      existing.push(card);
    } else {
      groups.set(key, [card]);
    }
  }
  return groups;
}

/** Format a relative time string from an ISO date */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActionsClient() {
  const router = useRouter();
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchCards = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      const res = await fetch("/api/action-cards/pending");
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards ?? []);
      }
    } catch {
      toast.error("Failed to load pending actions");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  /** Handle card action — same pattern as use-chat.ts */
  const handleCardAction = useCallback(
    async (cardId: string, actionName: string, editedData?: Record<string, unknown>) => {
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

        // Remove the card from the list (it's no longer pending)
        if (result.status !== "pending") {
          setCards((prev) => prev.filter((c) => c.id !== cardId));
        }
      } catch {
        toast.error("Action failed");
      }
    },
    []
  );

  /** Update card data for inline editing */
  const updateCardData = useCallback((cardId: string, newData: Record<string, unknown>) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, data: newData } : c))
    );
  }, []);

  const groups = groupByConversation(cards);

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-gold" />
              <h1 className="font-serif text-xl">Pending Actions</h1>
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
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Inbox className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <h2 className="text-lg font-medium text-muted-foreground mb-1">
                  No pending actions
                </h2>
                <p className="text-sm text-muted-foreground/70">
                  When Aurelius creates action cards in chat, pending ones will
                  appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Array.from(groups.entries()).map(
                  ([conversationId, groupCards]) => (
                    <div key={conversationId}>
                      {/* Conversation group header */}
                      <button
                        onClick={() => router.push(`/chat?c=${conversationId}`)}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2 group"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>
                          Conversation{" "}
                          <span className="font-mono text-xs">
                            {conversationId.slice(0, 8)}
                          </span>
                        </span>
                        <span className="text-xs opacity-60">
                          {timeAgo(groupCards[0].createdAt ?? "")}
                        </span>
                        <span className="text-xs opacity-0 group-hover:opacity-60 transition-opacity">
                          Open in chat
                        </span>
                      </button>

                      {/* Cards in this conversation */}
                      <div className="space-y-2">
                        {groupCards.map((card) => (
                          <ActionCard
                            key={card.id}
                            card={card}
                            onAction={(action, editedData) =>
                              handleCardAction(
                                card.id,
                                action,
                                editedData ?? card.data
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
                                  data ?? card.data
                                )
                              }
                            />
                          </ActionCard>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
