"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { TriageCard, TriageItem } from "@/components/aurelius/triage-card";
import { TriageActionMenu } from "@/components/aurelius/triage-action-menu";
import { TriageReplyComposer } from "@/components/aurelius/triage-reply-composer";
import { TriageSidebar } from "@/components/aurelius/triage-sidebar";
import { TriageDetailModal } from "@/components/aurelius/triage-detail-modal";
import { TriageChat } from "@/components/aurelius/triage-chat";
import { SuggestedTasksBox } from "@/components/aurelius/suggested-tasks-box";
import { TriageSnoozeMenu } from "@/components/aurelius/triage-snooze-menu";
import { toast } from "sonner";
import {
  Archive,
  Brain,
  Zap,
  MessageSquare,
  Inbox,
  RefreshCw,
  Mail,
  LayoutList,
  Filter,
  CalendarDays,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "triage" | "action" | "reply" | "detail" | "chat" | "snooze";
type ConnectorFilter = "all" | "gmail" | "slack" | "linear" | "granola";

// Define which actions are available for each connector
const CONNECTOR_ACTIONS: Record<string, {
  canReply: boolean;
  canArchive: boolean;
  canAddToMemory: boolean;
  canTakeActions: boolean;
  canChat: boolean;
}> = {
  gmail: { canReply: true, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  slack: { canReply: true, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  linear: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  granola: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  manual: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
};

const CONNECTOR_FILTERS: Array<{
  value: ConnectorFilter;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "all", label: "All", icon: Filter },
  { value: "gmail", label: "Gmail", icon: Mail },
  { value: "slack", label: "Slack", icon: MessageSquare },
  { value: "linear", label: "Linear", icon: LayoutList },
  { value: "granola", label: "Granola", icon: CalendarDays },
];

export function TriageClient() {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("triage");
  const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>("all");
  const [lastAction, setLastAction] = useState<{
    type: string;
    itemId: string;
    item: TriageItem;
  } | null>(null);
  const [stats, setStats] = useState({ new: 0, archived: 0, snoozed: 0, actioned: 0 });
  const [animatingOut, setAnimatingOut] = useState<"left" | "right" | "up" | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const sidebarWidth = isSidebarExpanded ? 480 : 320;

  // Fetch triage items
  const fetchItems = useCallback(async () => {
    try {
      const response = await fetch("/api/triage");
      const data = await response.json();
      setItems(data.items.map((item: any) => ({
        ...item,
        id: item.externalId || item.id,
      })));
      setStats(data.stats);
    } catch (error) {
      console.error("Failed to fetch triage items:", error);
      toast.error("Failed to load triage items");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Filter items by connector
  const filteredItems = connectorFilter === "all"
    ? items
    : items.filter((item) => item.connector === connectorFilter);

  // Current item (from filtered list)
  const currentItem = filteredItems[currentIndex];
  const hasItems = filteredItems.length > 0;
  const progress = hasItems ? `${currentIndex + 1} / ${filteredItems.length}` : "0 / 0";

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [connectorFilter]);

  // Get counts per connector
  const connectorCounts = {
    all: items.length,
    gmail: items.filter((i) => i.connector === "gmail").length,
    slack: items.filter((i) => i.connector === "slack").length,
    linear: items.filter((i) => i.connector === "linear").length,
    granola: items.filter((i) => i.connector === "granola").length,
  };

  // Archive action (←) - swipe animation + optimistic
  const handleArchive = useCallback(() => {
    if (!currentItem) return;

    const itemToArchive = currentItem;
    setAnimatingOut("left");
    setLastAction({ type: "archive", itemId: itemToArchive.id, item: itemToArchive });

    // Fire API calls in background immediately
    fetch(`/api/triage/${itemToArchive.id}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${itemToArchive.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    }).catch((error) => {
      console.error("Failed to archive:", error);
      toast.error("Failed to archive - item restored");
      setItems((prev) => [itemToArchive, ...prev]);
    });

    // Remove from list after brief animation
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== itemToArchive.id));
      setAnimatingOut(null);
    }, 150);

    toast.success("Archived", {
      action: {
        label: "Undo",
        onClick: () => handleUndo(),
      },
    });
  }, [currentItem]);

  // Memory summary action (↑) - Ollama summarizes before Supermemory
  const handleMemory = useCallback(async () => {
    if (!currentItem) return;

    fetch(`/api/triage/${currentItem.id}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "summary" }),
    }).catch((error) => {
      console.error("Failed to queue memory save:", error);
    });

    toast.success("Summarizing to memory...", {
      description: "Ollama summary → Supermemory",
    });
  }, [currentItem]);

  // Memory full action (Shift+↑) - send raw content to Supermemory
  const handleMemoryFull = useCallback(async () => {
    if (!currentItem) return;

    fetch(`/api/triage/${currentItem.id}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "full" }),
    }).catch((error) => {
      console.error("Failed to queue memory save:", error);
    });

    toast.success("Saving full to memory...", {
      description: "Full content → Supermemory",
    });
  }, [currentItem]);

  // Open action menu (→)
  const handleOpenActions = useCallback(() => {
    if (!currentItem) return;
    setViewMode("action");
  }, [currentItem]);

  // Open reply composer (↓) - only for connectors that support reply
  const handleOpenReply = useCallback(() => {
    if (!currentItem) return;
    const actions = CONNECTOR_ACTIONS[currentItem.connector];
    if (!actions?.canReply) {
      toast.info("Reply not available", {
        description: `${currentItem.connector} items don't support direct replies`,
      });
      return;
    }
    setViewMode("reply");
  }, [currentItem]);

  // Open detail view (Enter)
  const handleOpenDetail = useCallback(() => {
    if (!currentItem) return;
    setViewMode("detail");
  }, [currentItem]);

  // Open chat about this item (Space)
  const handleOpenChat = useCallback(() => {
    if (!currentItem) return;
    setViewMode("chat");
  }, [currentItem]);

  // Open snooze menu (s)
  const handleOpenSnooze = useCallback(() => {
    if (!currentItem) return;
    setViewMode("snooze");
  }, [currentItem]);

  // Spam action (x) - swipe animation + optimistic
  const handleSpam = useCallback(() => {
    if (!currentItem) return;

    const itemToSpam = currentItem;
    setAnimatingOut("left");
    setLastAction({ type: "spam", itemId: itemToSpam.id, item: itemToSpam });

    // Fire API calls in background immediately
    fetch(`/api/triage/${itemToSpam.id}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${itemToSpam.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "spam" }),
    }).catch((error) => {
      console.error("Failed to mark as spam:", error);
      toast.error("Failed to mark as spam - item restored");
      setItems((prev) => [itemToSpam, ...prev]);
    });

    // Remove from list after brief animation
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== itemToSpam.id));
      setAnimatingOut(null);
    }, 150);

    toast.success("Marked as spam", {
      action: {
        label: "Undo",
        onClick: () => handleUndo(),
      },
    });
  }, [currentItem]);

  // Handle snooze selection - swipe animation + optimistic
  const handleSnooze = useCallback((until: Date) => {
    if (!currentItem) return;

    const itemToSnooze = currentItem;
    setViewMode("triage");
    setAnimatingOut("right");
    setLastAction({ type: "snooze", itemId: itemToSnooze.id, item: itemToSnooze });

    // Fire API calls in background immediately
    fetch(`/api/triage/${itemToSnooze.id}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${itemToSnooze.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze", snoozeUntil: until.toISOString() }),
    }).catch((error) => {
      console.error("Failed to snooze:", error);
      toast.error("Failed to snooze - item restored");
      setItems((prev) => [itemToSnooze, ...prev]);
    });

    // Remove from list after brief animation
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== itemToSnooze.id));
      setAnimatingOut(null);
    }, 150);

    toast.success(`Snoozed until ${until.toLocaleDateString()} ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, {
      action: {
        label: "Undo",
        onClick: () => handleUndo(),
      },
    });
  }, [currentItem]);

  // Close overlays
  const handleCloseOverlay = useCallback(() => {
    setViewMode("triage");
  }, []);

  // Handle action from menu
  const handleActionComplete = useCallback(async (action: string, data?: any) => {
    if (!currentItem) return;

    try {
      await fetch(`/api/triage/${currentItem.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });

      // Some actions move to next item
      if (action === "snooze" || action === "actioned") {
        setAnimatingOut("right");
        await new Promise((resolve) => setTimeout(resolve, 200));
        setItems((prev) => prev.filter((i) => i.id !== currentItem.id));
        setAnimatingOut(null);
      }

      toast.success(getActionMessage(action));
    } catch (error) {
      console.error(`Failed to perform ${action}:`, error);
      toast.error(`Failed to ${action}`);
    }

    setViewMode("triage");
  }, [currentItem]);

  // Undo last action - instant, brings item back on screen
  const handleUndo = useCallback(() => {
    if (!lastAction) return;

    const itemToRestore = lastAction.item;

    // Immediately add item back to front and reset index to show it
    setItems((prev) => [itemToRestore, ...prev]);
    setCurrentIndex(0);
    setLastAction(null);

    // Fire restore API in background
    fetch(`/api/triage/${lastAction.itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    }).catch((error) => {
      console.error("Failed to restore:", error);
      toast.error("Failed to restore on server");
    });

    toast.success("Restored");
  }, [lastAction]);

  // Reset inbox (for development)
  const handleReset = useCallback(async () => {
    try {
      await fetch("/api/triage", { method: "POST" });
      setCurrentIndex(0);
      await fetchItems();
      toast.success("Inbox reset with fresh data");
    } catch (error) {
      console.error("Failed to reset:", error);
      toast.error("Failed to reset");
    }
  }, [fetchItems]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Handle escape
      if (e.key === "Escape") {
        if (viewMode !== "triage") {
          handleCloseOverlay();
          return;
        }
      }

      // Only handle arrows in triage mode
      if (viewMode !== "triage") return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          handleArchive();
          break;
        case "ArrowUp":
          e.preventDefault();
          if (e.shiftKey) {
            handleMemoryFull();
          } else {
            handleMemory();
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          handleOpenActions();
          break;
        case "ArrowDown":
          e.preventDefault();
          handleOpenReply();
          break;
        case "Enter":
          e.preventDefault();
          handleOpenDetail();
          break;
        case " ":
          e.preventDefault();
          handleOpenChat();
          break;
        case "s":
          e.preventDefault();
          handleOpenSnooze();
          break;
        case "x":
          e.preventDefault();
          handleSpam();
          break;
        case "l":
        case "L":
          // Open in Linear (if Linear item with URL)
          if (currentItem?.connector === "linear") {
            const linearUrl = (currentItem.enrichment as Record<string, unknown>)?.linearUrl as string | undefined;
            if (linearUrl) {
              e.preventDefault();
              window.open(linearUrl, "_blank", "noopener,noreferrer");
            }
          }
          break;
        case "u":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleUndo();
          }
          break;
        case "z":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleUndo();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    viewMode,
    currentItem,
    handleArchive,
    handleMemory,
    handleMemoryFull,
    handleOpenActions,
    handleOpenReply,
    handleOpenDetail,
    handleOpenChat,
    handleOpenSnooze,
    handleSpam,
    handleCloseOverlay,
    handleUndo,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">Loading triage queue...</div>
        </div>
      </AppShell>
    );
  }

  // Empty state
  if (!hasItems) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Inbox className="w-16 h-16 text-muted-foreground" />
          <h2 className="font-serif text-2xl text-gold">Inbox Zero</h2>
          <p className="text-muted-foreground text-center max-w-md">
            You've triaged everything! Take a break or reset the inbox with fake
            data to test more.
          </p>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-background font-medium hover:bg-gold/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reset with fake data
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      rightSidebar={
        <TriageSidebar
          stats={stats}
          isExpanded={isSidebarExpanded}
          onToggleExpand={() => setIsSidebarExpanded(!isSidebarExpanded)}
        />
      }
      wideSidebar={true}
      sidebarWidth={sidebarWidth}
    >
      <div className="flex-1 flex flex-col h-screen">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-xl text-gold">Triage</h1>
              <span className="text-sm text-muted-foreground font-mono">
                {progress}
              </span>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Reset with fake data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          {/* Connector filters */}
          <div className="flex items-center gap-2">
            {CONNECTOR_FILTERS.map((filter) => {
              const Icon = filter.icon;
              const count = connectorCounts[filter.value];
              const isActive = connectorFilter === filter.value;

              return (
                <button
                  key={filter.value}
                  onClick={() => setConnectorFilter(filter.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    isActive
                      ? "bg-gold/20 text-gold border border-gold/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{filter.label}</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-[10px]",
                    isActive ? "bg-gold/30" : "bg-secondary"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        {/* Card area */}
        <div className="flex-1 flex items-start justify-center pt-12 p-6 relative overflow-y-auto">
          {/* Card stack effect - show next cards behind */}
          {filteredItems.slice(currentIndex + 1, currentIndex + 3).map((item, idx) => (
            <div
              key={item.id}
              className="absolute"
              style={{
                transform: `scale(${0.95 - idx * 0.03}) translateY(${(idx + 1) * 8}px)`,
                zIndex: 10 - idx,
                opacity: 0.3 - idx * 0.1,
              }}
            >
              <TriageCard item={item} isActive={false} />
            </div>
          ))}

          {/* Active card and tasks box */}
          <div className="flex flex-col items-center gap-4">
            <div
              className={cn(
                "relative z-20 transition-all duration-200",
                animatingOut === "left" && "animate-swipe-left",
                animatingOut === "right" && "animate-swipe-right",
                animatingOut === "up" && "animate-swipe-up"
              )}
            >
              <TriageCard ref={cardRef} item={currentItem} isActive={true} />
            </div>

            {/* Suggested tasks box */}
            {currentItem && !animatingOut && (
              <SuggestedTasksBox itemId={currentItem.id} />
            )}
          </div>

        </div>

        {/* Bottom keyboard hints (always visible) */}
        <div className="px-6 py-3 border-t border-border bg-background shrink-0">
          {(() => {
            const connectorActions = currentItem ? CONNECTOR_ACTIONS[currentItem.connector] : null;
            return (
              <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
                <ActionButton
                  keyName="←"
                  label="Archive"
                  onClick={handleArchive}
                  color="text-red-400"
                />
                <ActionButton
                  keyName="↑"
                  label="Summary"
                  onClick={handleMemory}
                  color="text-gold"
                />
                <ActionButton
                  keyName="⇧↑"
                  label="Full"
                  onClick={handleMemoryFull}
                  color="text-gold"
                />
                <ActionButton
                  keyName="s"
                  label="Snooze"
                  onClick={handleOpenSnooze}
                  color="text-orange-400"
                />
                <ActionButton
                  keyName="x"
                  label="Spam"
                  onClick={handleSpam}
                  color="text-red-500"
                />
                <ActionButton
                  keyName="␣"
                  label="Chat"
                  onClick={handleOpenChat}
                  color="text-purple-400"
                />
                <ActionButton
                  keyName="↵"
                  label="Expand"
                  onClick={handleOpenDetail}
                  color="text-foreground"
                />
                <ActionButton
                  keyName="→"
                  label="Actions"
                  onClick={handleOpenActions}
                  color="text-blue-400"
                />
                {connectorActions?.canReply && (
                  <ActionButton
                    keyName="↓"
                    label="Reply"
                    onClick={handleOpenReply}
                    color="text-green-400"
                  />
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Action menu overlay */}
      {viewMode === "action" && currentItem && (
        <TriageActionMenu
          item={currentItem}
          onAction={handleActionComplete}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Reply composer overlay */}
      {viewMode === "reply" && currentItem && (
        <TriageReplyComposer
          item={currentItem}
          onSend={(message) => {
            // In production, this would send the reply
            toast.success("Reply sent (simulated)");
            handleActionComplete("actioned");
          }}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Detail modal */}
      {viewMode === "detail" && currentItem && (
        <TriageDetailModal item={currentItem} onClose={handleCloseOverlay} />
      )}

      {/* Chat overlay */}
      {viewMode === "chat" && currentItem && (
        <TriageChat
          item={currentItem}
          onClose={handleCloseOverlay}
          onAction={(action, data) => {
            // Handle actions from chat (e.g., snooze, add to memory)
            if (action === "snooze") {
              handleActionComplete("snoozed");
            } else if (action === "archive") {
              handleActionComplete("archived");
            }
            // For memory actions, the chat API handles it directly
          }}
        />
      )}

      {/* Snooze menu overlay */}
      {viewMode === "snooze" && currentItem && (
        <TriageSnoozeMenu
          onSnooze={handleSnooze}
          onClose={handleCloseOverlay}
        />
      )}
    </AppShell>
  );
}

// Action button component
function ActionButton({
  keyName,
  label,
  onClick,
  color,
}: {
  keyName: string;
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors group"
      )}
    >
      <kbd
        className={cn(
          "px-2 py-1 rounded bg-secondary border border-border font-mono text-sm transition-colors",
          "group-hover:border-gold/50 group-hover:bg-gold/10"
        )}
      >
        {keyName}
      </kbd>
      <span className={cn("transition-colors", `group-hover:${color}`)}>
        {label}
      </span>
    </button>
  );
}

// Get action message
function getActionMessage(action: string): string {
  switch (action) {
    case "archive":
      return "Archived";
    case "snooze":
      return "Snoozed";
    case "flag":
      return "Flagged";
    case "priority":
      return "Priority updated";
    case "tag":
      return "Tag added";
    case "actioned":
      return "Marked as done";
    default:
      return "Action completed";
  }
}
