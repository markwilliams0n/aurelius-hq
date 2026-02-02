"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { TriageCard, TriageItem } from "@/components/aurelius/triage-card";
import { TriageActionMenu } from "@/components/aurelius/triage-action-menu";
import { TriageReplyComposer } from "@/components/aurelius/triage-reply-composer";
import { TriageSidebar } from "@/components/aurelius/triage-sidebar";
import { toast } from "sonner";
import {
  Archive,
  ArrowUp,
  ArrowRight,
  MessageSquare,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "triage" | "action" | "reply";

export function TriageClient() {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("triage");
  const [lastAction, setLastAction] = useState<{
    type: string;
    itemId: string;
    item: TriageItem;
  } | null>(null);
  const [stats, setStats] = useState({ new: 0, archived: 0, snoozed: 0, actioned: 0 });
  const [animatingOut, setAnimatingOut] = useState<"left" | "right" | "up" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Current item
  const currentItem = items[currentIndex];
  const hasItems = items.length > 0;
  const progress = hasItems ? `${currentIndex + 1} / ${items.length}` : "0 / 0";

  // Archive action (←)
  const handleArchive = useCallback(async () => {
    if (!currentItem) return;

    setAnimatingOut("left");
    setLastAction({ type: "archive", itemId: currentItem.id, item: currentItem });

    // Wait for animation
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      await fetch(`/api/triage/${currentItem.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });

      // Remove from list
      setItems((prev) => prev.filter((i) => i.id !== currentItem.id));
      toast.success("Archived", {
        action: {
          label: "Undo",
          onClick: () => handleUndo(),
        },
      });
    } catch (error) {
      console.error("Failed to archive:", error);
      toast.error("Failed to archive");
    }

    setAnimatingOut(null);
  }, [currentItem]);

  // Memory action (↑)
  const handleMemory = useCallback(async () => {
    if (!currentItem) return;

    setAnimatingOut("up");

    try {
      const response = await fetch(`/api/triage/${currentItem.id}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      toast.success(`Saved ${data.facts.length} facts to memory`, {
        description: data.facts[0]?.content?.slice(0, 60) + "...",
      });
    } catch (error) {
      console.error("Failed to save to memory:", error);
      toast.error("Failed to save to memory");
    }

    // Don't remove from list - memory is non-destructive
    setAnimatingOut(null);
  }, [currentItem]);

  // Open action menu (→)
  const handleOpenActions = useCallback(() => {
    if (!currentItem) return;
    setViewMode("action");
  }, [currentItem]);

  // Open reply composer (↓)
  const handleOpenReply = useCallback(() => {
    if (!currentItem) return;
    setViewMode("reply");
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

  // Undo last action
  const handleUndo = useCallback(async () => {
    if (!lastAction) return;

    try {
      await fetch(`/api/triage/${lastAction.itemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });

      // Add item back to list
      setItems((prev) => [lastAction.item, ...prev]);
      setLastAction(null);
      toast.success("Action undone");
    } catch (error) {
      console.error("Failed to undo:", error);
      toast.error("Failed to undo");
    }
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
          handleMemory();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleOpenActions();
          break;
        case "ArrowDown":
          e.preventDefault();
          handleOpenReply();
          break;
        case "u":
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
    handleArchive,
    handleMemory,
    handleOpenActions,
    handleOpenReply,
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
    <AppShell rightSidebar={<TriageSidebar item={currentItem} stats={stats} />}>
      <div className="flex-1 flex flex-col h-screen">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
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
        </header>

        {/* Card area */}
        <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
          {/* Card stack effect - show next cards behind */}
          {items.slice(currentIndex + 1, currentIndex + 3).map((item, idx) => (
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

          {/* Active card */}
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

          {/* Action indicators */}
          {animatingOut && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              {animatingOut === "left" && (
                <div className="bg-red-500/20 text-red-400 rounded-full p-6">
                  <Archive className="w-12 h-12" />
                </div>
              )}
              {animatingOut === "up" && (
                <div className="bg-gold/20 text-gold rounded-full p-6">
                  <ArrowUp className="w-12 h-12" />
                </div>
              )}
              {animatingOut === "right" && (
                <div className="bg-blue-500/20 text-blue-400 rounded-full p-6">
                  <ArrowRight className="w-12 h-12" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom keyboard hints (always visible) */}
        <div className="px-6 py-3 border-t border-border bg-background shrink-0">
          <div className="flex items-center justify-center gap-8 text-sm text-muted-foreground">
            <ActionButton
              keyName="←"
              label="Archive"
              onClick={handleArchive}
              color="text-red-400"
            />
            <ActionButton
              keyName="↑"
              label="Save to Memory"
              onClick={handleMemory}
              color="text-gold"
            />
            <ActionButton
              keyName="→"
              label="Actions"
              onClick={handleOpenActions}
              color="text-blue-400"
            />
            <ActionButton
              keyName="↓"
              label="Reply"
              onClick={handleOpenReply}
              color="text-green-400"
            />
          </div>
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
