"use client";

import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { TriageCard, TriageItem } from "@/components/aurelius/triage-card";
import { TriageBatchCard } from "@/components/aurelius/triage-batch-card";
import { TriageListView } from "@/components/aurelius/triage-list-view";
import type { BatchCardWithItems } from "@/lib/triage/batch-cards";
import { TriageActionMenu } from "@/components/aurelius/triage-action-menu";
import { TriageReplyComposer } from "@/components/aurelius/triage-reply-composer";
import { TriageSidebar } from "@/components/aurelius/triage-sidebar";
import { TriageDetailModal } from "@/components/aurelius/triage-detail-modal";
import { TriageChat } from "@/components/aurelius/triage-chat";
import { SuggestedTasksBox } from "@/components/aurelius/suggested-tasks-box";
import { TriageSnoozeMenu } from "@/components/aurelius/triage-snooze-menu";
import { TaskCreatorPanel } from "@/components/aurelius/task-creator-panel";
import { TriageGroupPicker } from "@/components/aurelius/triage-group-picker";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import type { ActionCardData } from "@/lib/types/action-card";
import { toast } from "sonner";
import {
  MessageSquare,
  Inbox,
  Mail,
  LayoutList,
  Filter,
  CalendarDays,
  RefreshCw,
  LayoutGrid,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "triage" | "action" | "reply" | "detail" | "chat" | "snooze" | "create-task" | "quick-task" | "group-picker";
type ConnectorFilter = "all" | "gmail" | "slack" | "linear" | "granola";
type TriageView = "card" | "list";

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

// Cache for triage data to avoid refetching on every page visit
let triageCache: {
  data: { items: TriageItem[]; stats: any; tasksByItemId: Record<string, any[]>; senderCounts: Record<string, number>; batchCards: BatchCardWithItems[] } | null;
  timestamp: number;
} = { data: null, timestamp: 0 };

const CACHE_STALE_MS = 5 * 60 * 1000; // 5 minutes

export function TriageClient({ userEmail }: { userEmail?: string }) {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [batchCards, setBatchCards] = useState<BatchCardWithItems[]>([]);
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
  const [tasksByItemId, setTasksByItemId] = useState<Record<string, any[]>>({});
  const [senderCounts, setSenderCounts] = useState<Record<string, number>>({});
  const [triageRules, setTriageRules] = useState<any[]>([]);
  const [animatingOut, setAnimatingOut] = useState<"left" | "right" | "up" | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [triageView, setTriageView] = useState<TriageView>("card");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [returnToList, setReturnToList] = useState(false);
  const [quickTaskCard, setQuickTaskCard] = useState<ActionCardData | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastActionRef = useRef<{ type: string; itemId: string; item: TriageItem } | null>(null);
  const bulkUndoRef = useRef<TriageItem[]>([]);

  // Keep ref in sync with state (state for re-renders, ref for closures)
  useEffect(() => {
    lastActionRef.current = lastAction;
  }, [lastAction]);

  const sidebarWidth = isSidebarExpanded ? 480 : 320;

  // Fetch triage items with stale-while-revalidate caching
  const fetchItems = useCallback(async (opts?: { skipCache?: boolean }) => {
    const now = Date.now();
    const cached = triageCache.data;
    const isStale = now - triageCache.timestamp > CACHE_STALE_MS;

    // Serve from cache immediately if available
    if (cached && !opts?.skipCache) {
      setItems(cached.items);
      setStats(cached.stats);
      setTasksByItemId(cached.tasksByItemId);
      setSenderCounts(cached.senderCounts);
      setBatchCards(cached.batchCards);
      setIsLoading(false);

      // If cache is fresh, don't refetch
      if (!isStale) return;
    }

    // Fetch fresh data (in background if we served from cache)
    try {
      const response = await fetch("/api/triage");
      const data = await response.json();
      const mappedItems = data.items.map((item: any) => ({
        ...item,
        dbId: item.id,
        id: item.externalId || item.id,
      }));

      // Update cache
      triageCache = {
        data: {
          items: mappedItems,
          stats: data.stats,
          tasksByItemId: data.tasksByItemId || {},
          senderCounts: data.senderCounts || {},
          batchCards: data.batchCards || [],
        },
        timestamp: Date.now(),
      };

      setItems(mappedItems);
      setStats(data.stats);
      setTasksByItemId(data.tasksByItemId || {});
      setSenderCounts(data.senderCounts || {});
      setBatchCards(data.batchCards || []);

      // Fetch triage rules in parallel
      try {
        const rulesRes = await fetch("/api/triage/rules");
        const rulesData = await rulesRes.json();
        setTriageRules(rulesData.rules || []);
      } catch (rulesError) {
        console.error("Failed to fetch triage rules:", rulesError);
      }
    } catch (error) {
      console.error("Failed to fetch triage items:", error);
      if (!cached) toast.error("Failed to load triage items");
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

  // Batch card navigation: batch cards occupy indices 0..batchCards.length-1,
  // individual items start at batchCards.length
  const batchCardCount = batchCards.length;
  const isOnBatchCard = currentIndex < batchCardCount;
  const currentBatchCard = isOnBatchCard ? batchCards[currentIndex] : null;
  const individualItemIndex = currentIndex - batchCardCount;

  // Current item (from filtered list, offset by batch card count)
  const currentItem = isOnBatchCard ? undefined : filteredItems[individualItemIndex];
  const totalCards = batchCardCount + filteredItems.length;
  const hasItems = totalCards > 0;
  const progress = hasItems ? `${currentIndex + 1} / ${totalCards}` : "0 / 0";

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

  // Batch card action handler
  const handleBatchAction = useCallback(
    async (cardId: string, checkedIds: string[], uncheckedIds: string[]) => {
      try {
        await fetch(`/api/triage/batch/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkedItemIds: checkedIds,
            uncheckedItemIds: uncheckedIds,
          }),
        });

        // Remove the batch card from state and refresh
        setBatchCards((prev) => prev.filter((c) => c.id !== cardId));
        // Invalidate cache and refresh
        triageCache = { data: null, timestamp: 0 };
        fetchItems({ skipCache: true });
        toast.success(
          `Batch action complete: ${checkedIds.length} processed, ${uncheckedIds.length} kept`
        );
      } catch (error) {
        console.error("Failed to execute batch action:", error);
        toast.error("Batch action failed");
      }
    },
    [fetchItems]
  );

  // Reclassify handler — moves item between batch groups and creates a rule
  const handleReclassify = useCallback(
    async (
      itemId: string,
      fromBatchType: string,
      toBatchType: string,
      sender: string,
      senderName: string | null,
      connector: string
    ) => {
      try {
        const res = await fetch("/api/triage/batch/reclassify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            fromBatchType,
            toBatchType,
            sender,
            senderName,
            connector,
          }),
        });
        if (!res.ok) throw new Error("Reclassify failed");

        // Remove item from current batch card in state
        setBatchCards((prev) =>
          prev
            .map((card) => {
              const cardBatchType = (card.data?.batchType as string) || "";
              if (cardBatchType === fromBatchType) {
                return {
                  ...card,
                  items: card.items.filter((i) => i.id !== itemId),
                };
              }
              return card;
            })
            .filter((card) => card.items.length > 0)
        );

        toast.success(`Moved to ${toBatchType} — rule created`);
      } catch (error) {
        console.error("Reclassify failed:", error);
        toast.error("Failed to reclassify item");
      }
    },
    []
  );

  // Delete a triage rule
  const handleDeleteRule = useCallback(async (ruleId: string) => {
    try {
      await fetch(`/api/triage/rules/${ruleId}`, { method: "DELETE" });
      setTriageRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success("Rule deleted");
    } catch (error) {
      console.error("Failed to delete rule:", error);
      toast.error("Failed to delete rule");
    }
  }, []);

  // Rule input handler
  const handleRuleInput = useCallback(async (input: string) => {
    try {
      await fetch("/api/triage/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, source: "user_chat" }),
      });
      toast.success("Rule created from your input");
    } catch (error) {
      console.error("Failed to create rule:", error);
      toast.error("Failed to create rule");
    }
  }, []);

  // Archive action (←) - swipe animation + optimistic
  const handleArchive = useCallback(() => {
    if (!currentItem) return;

    const itemToArchive = currentItem;
    const apiId = itemToArchive.dbId || itemToArchive.id;
    setAnimatingOut("left");
    setLastAction({ type: "archive", itemId: itemToArchive.id, item: itemToArchive });

    // Fire API calls in background immediately (use dbId for reliable lookup)
    fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
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

    const apiId = currentItem.dbId || currentItem.id;
    fetch(`/api/triage/${apiId}/memory`, {
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

    const apiId = currentItem.dbId || currentItem.id;
    fetch(`/api/triage/${apiId}/memory`, {
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

  // Action Needed (a) - 3-day snooze + Gmail label, swipe animation + await API
  const handleActionNeeded = useCallback(async (targetItem?: TriageItem) => {
    const itemToAction = targetItem || currentItem;
    if (!itemToAction) return;

    if (itemToAction.connector !== "gmail") {
      toast.info("Action Needed is only available for Gmail items");
      return;
    }

    // Use dbId for reliable DB lookup
    const apiId = itemToAction.dbId || itemToAction.id;

    setAnimatingOut("right");
    setLastAction({ type: "action-needed", itemId: itemToAction.id, item: itemToAction });

    // Await the API call to ensure DB is updated before any refetch can occur
    try {
      fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
      const res = await fetch(`/api/triage/${apiId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "action-needed" }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
    } catch (error) {
      console.error("Failed to mark action needed:", error);
      toast.error("Failed to mark for action - item restored");
      setAnimatingOut(null);
      return;
    }

    // Remove from list after API confirms
    setItems((prev) => prev.filter((i) => i.id !== itemToAction.id));
    setAnimatingOut(null);

    toast.success("Marked for action (3 days)", {
      action: {
        label: "Undo",
        onClick: () => handleUndo(),
      },
    });
  }, [currentItem]);

  // Spam action (x) - swipe animation + optimistic
  const handleSpam = useCallback(() => {
    if (!currentItem) return;

    const itemToSpam = currentItem;
    const apiId = itemToSpam.dbId || itemToSpam.id;
    setAnimatingOut("left");
    setLastAction({ type: "spam", itemId: itemToSpam.id, item: itemToSpam });

    // Fire API calls in background immediately (use dbId for reliable lookup)
    fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
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
    const apiId = itemToSnooze.dbId || itemToSnooze.id;
    setViewMode("triage");
    setAnimatingOut("right");
    setLastAction({ type: "snooze", itemId: itemToSnooze.id, item: itemToSnooze });

    // Fire API calls in background immediately (use dbId for reliable lookup)
    fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
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

    // Open task creator panel instead of marking as actioned
    if (action === "create-task") {
      setViewMode("create-task");
      return;
    }

    // Classify into a group
    if (action === "classify" && data?.batchType) {
      try {
        const res = await fetch("/api/triage/batch/reclassify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: currentItem.dbId || currentItem.id,
            fromBatchType: "individual",
            toBatchType: data.batchType,
            sender: currentItem.sender,
            senderName: currentItem.senderName,
            connector: currentItem.connector,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error("Classify API error:", res.status, errBody);
          throw new Error(errBody.error || "Classify failed");
        }

        // Remove item from individual items list (it's now in a batch card)
        setAnimatingOut("right");
        await new Promise((resolve) => setTimeout(resolve, 200));
        setItems((prev) => prev.filter((i) => i.id !== currentItem.id));
        setAnimatingOut(null);
        toast.success(`Classified as ${data.batchType} — rule created`);
      } catch (error) {
        console.error("Classify failed:", error);
        toast.error("Failed to classify item");
      }
      setViewMode("triage");
      return;
    }

    const apiId = currentItem.dbId || currentItem.id;
    try {
      await fetch(`/api/triage/${apiId}`, {
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
    const action = lastActionRef.current;
    if (!action) return;

    if (action.type === "bulk-archive") {
      const itemsToRestore = bulkUndoRef.current;
      setItems((prev) => [...itemsToRestore, ...prev]);
      setCurrentIndex(0);

      // Restore all via API (use dbId for reliable lookup)
      itemsToRestore.forEach((item) => {
        const restoreId = item.dbId || item.id;
        fetch(`/api/triage/${restoreId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        }).catch(console.error);
      });

      bulkUndoRef.current = [];
    } else {
      let itemToRestore = action.item;

      // If undoing action-needed, clear the actionNeededDate from enrichment
      if (action.type === "action-needed" && itemToRestore.enrichment) {
        const { actionNeededDate, ...restEnrichment } = itemToRestore.enrichment as Record<string, unknown>;
        itemToRestore = { ...itemToRestore, enrichment: restEnrichment };
      }

      // Immediately add item back to front and reset index to show it
      setItems((prev) => [itemToRestore, ...prev]);
      setCurrentIndex(0);

      // Fire restore API in background (use dbId for reliable lookup)
      const restoreId = action.item.dbId || action.itemId;
      fetch(`/api/triage/${restoreId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", previousAction: action.type }),
      }).catch((error) => {
        console.error("Failed to restore:", error);
        toast.error("Failed to restore on server");
      });
    }

    setLastAction(null);
    lastActionRef.current = null;
    toast.success("Restored");
  }, []);

  // Sync all connectors (fire-and-forget, poll for completion)
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    toast.info("Syncing connectors...");

    // Fire heartbeat in background — don't await (can take 2+ min)
    fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    })
      .then(() => {
        // Final refresh when heartbeat completes
        triageCache = { data: null, timestamp: 0 };
        fetchItems({ skipCache: true });
        toast.success("Sync complete");
        setIsSyncing(false);
      })
      .catch((error) => {
        console.error("Sync failed:", error);
        toast.error("Sync failed");
        setIsSyncing(false);
      });

    // Refresh triage data immediately (shows current DB state)
    triageCache = { data: null, timestamp: 0 };
    await fetchItems({ skipCache: true });
  }, [isSyncing, fetchItems]);

  // Bulk archive selected items (list view)
  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const idsToArchive = Array.from(selectedIds);
    const itemsToArchive = items.filter((i) => selectedIds.has(i.id));
    const count = idsToArchive.length;

    // Store for undo
    setLastAction({ type: "bulk-archive", itemId: idsToArchive[0], item: itemsToArchive[0] });
    bulkUndoRef.current = itemsToArchive;

    // Optimistically remove items
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setSelectedIds(new Set());

    // Fire archive API calls (fire-and-forget, use dbId for reliable lookup)
    itemsToArchive.forEach((item) => {
      const apiId = item.dbId || item.id;
      fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
      fetch(`/api/triage/${apiId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      }).catch(console.error);
    });

    toast.success(`Archived ${count} item${count === 1 ? "" : "s"}`, {
      action: {
        label: "Undo",
        onClick: () => handleUndo(),
      },
    });
  }, [selectedIds, items, handleUndo]);

  // List view: toggle select
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // List view: select all filtered items
  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredItems.map((i) => i.id)));
  }, [filteredItems]);

  // List view: clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // List view: open an item (switch to card view for that item)
  const handleOpenListItem = useCallback((id: string) => {
    const index = filteredItems.findIndex((i) => i.id === id);
    if (index >= 0) {
      setCurrentIndex(index + batchCardCount);
      setReturnToList(true);
      setTriageView("card");
    }
  }, [filteredItems, batchCardCount]);

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
          // If returning to list from card detail view
          if (returnToList) {
            setReturnToList(false);
            setTriageView("list");
            setViewMode("triage");
            return;
          }
          handleCloseOverlay();
          return;
        }
        // In base triage mode with card view opened from list
        if (returnToList && triageView === "card") {
          setReturnToList(false);
          setTriageView("list");
          return;
        }
      }

      // Tab cycles through connector filters (works in all modes)
      if (e.key === "Tab") {
        e.preventDefault();
        const filterValues = CONNECTOR_FILTERS.map((f) => f.value);
        const currentIdx = filterValues.indexOf(connectorFilter);
        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + filterValues.length) % filterValues.length
          : (currentIdx + 1) % filterValues.length;
        setConnectorFilter(filterValues[nextIdx]);
        return;
      }

      // Cmd+1-5 selects connector filters directly (works in all modes)
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= String(CONNECTOR_FILTERS.length)) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < CONNECTOR_FILTERS.length) {
          setConnectorFilter(CONNECTOR_FILTERS[idx].value);
        }
        return;
      }

      // Toggle view with 'v' (works in base triage mode, both card and list)
      if (e.key === "v" && viewMode === "triage") {
        e.preventDefault();
        setTriageView((prev) => (prev === "card" ? "list" : "card"));
        setSelectedIds(new Set());
        setReturnToList(false);
        return;
      }

      // Only handle card-mode keys in triage mode
      if (viewMode !== "triage" || triageView === "list") return;

      // When on a batch card, the TriageBatchCard component handles its own
      // keyboard events (j/k/Space/a/n/ArrowLeft). We only let Escape and
      // global keys (Tab, Cmd+1-5, v) through from the triage client.
      // However, we do NOT intercept ArrowRight/ArrowDown for card-to-card
      // navigation — those aren't used by batch cards. We'll add "next/prev
      // card" navigation via Escape (already handled above) or a dedicated key.
      if (isOnBatchCard) return;

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
        case "t":
          e.preventDefault();
          if (currentItem) {
            // Create a pre-filled Linear issue action card
            const taskApiId = currentItem.dbId || currentItem.id;
            fetch(`/api/triage/${taskApiId}/quick-task`, { method: "POST" })
              .then((res) => res.json())
              .then((data) => {
                if (data.card) {
                  setQuickTaskCard(data.card);
                  setViewMode("quick-task");
                } else {
                  toast.error(data.error || "Failed to create task card");
                }
              })
              .catch(() => toast.error("Failed to create task card"));
          }
          break;
        case "a":
          e.preventDefault();
          handleActionNeeded();
          break;
        case "g":
          e.preventDefault();
          setViewMode("group-picker");
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
    triageView,
    returnToList,
    currentItem,
    connectorFilter,
    isOnBatchCard,
    handleArchive,
    handleMemory,
    handleMemoryFull,
    handleOpenActions,
    handleOpenReply,
    handleOpenDetail,
    handleOpenChat,
    handleOpenSnooze,
    handleSpam,
    handleActionNeeded,
    handleCloseOverlay,
    handleUndo,
  ]);

  return (
    <AppShell
      rightSidebar={
        !isLoading ? (
          <TriageSidebar
            stats={stats}
            isExpanded={isSidebarExpanded}
            onToggleExpand={() => setIsSidebarExpanded(!isSidebarExpanded)}
            onUndo={async (_activityId, _action, itemId) => {
              try {
                await fetch(`/api/triage/${itemId}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "restore" }),
                });
                await fetchItems({ skipCache: true });
                toast.success("Restored");
              } catch (error) {
                console.error("Failed to undo:", error);
                toast.error("Failed to undo");
              }
            }}
          />
        ) : undefined
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
              {!isLoading && (
                <span className="text-sm text-muted-foreground font-mono">
                  {progress}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => { setTriageView("card"); setSelectedIds(new Set()); setReturnToList(false); }}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
                    triageView === "card"
                      ? "bg-gold/20 text-gold"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                  title="Card view (v)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setTriageView("list"); setReturnToList(false); }}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
                    triageView === "list"
                      ? "bg-gold/20 text-gold"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                  title="List view (v)"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                title="Sync all connectors"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin")} />
                {isSyncing ? "Syncing..." : "Sync"}
              </button>
            </div>
          </div>

          {/* Connector filters */}
          <div className="flex items-center gap-2">
            {CONNECTOR_FILTERS.map((filter, index) => {
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
                  title={`${filter.label} (${"\u2318"}${index + 1})`}
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

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground">Loading triage queue...</div>
          </div>
        )}

        {/* Empty state - shows below tabs */}
        {!isLoading && !hasItems && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Inbox className="w-16 h-16 text-muted-foreground" />
            <h2 className="font-serif text-2xl text-gold">Inbox Zero</h2>
            <p className="text-muted-foreground text-center max-w-md">
              All caught up. New items will appear after the next sync.
            </p>
          </div>
        )}

        {/* List view */}
        {!isLoading && hasItems && triageView === "list" && (
          <TriageListView
            items={filteredItems}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onBulkArchive={handleBulkArchive}
            onOpenItem={handleOpenListItem}
            onActionNeeded={handleActionNeeded}
          />
        )}

        {/* Card area */}
        {!isLoading && hasItems && triageView === "card" && (
        <div className="flex-1 flex items-start justify-center pt-12 p-6 relative overflow-y-auto">
          {/* Card stack effect - show next items behind (only for individual cards) */}
          {!isOnBatchCard && filteredItems.slice(individualItemIndex + 1, individualItemIndex + 3).map((item, idx) => (
            <div
              key={`${item.id}-stack-${idx}`}
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
            {/* Batch card */}
            {isOnBatchCard && currentBatchCard && (
              <div className="relative z-20">
                <TriageBatchCard
                  card={currentBatchCard}
                  isActive={true}
                  onAction={handleBatchAction}
                  onRuleInput={handleRuleInput}
                  onReclassify={handleReclassify}
                  rules={triageRules.filter((r) => r.action?.batchType === (currentBatchCard.data?.batchType as string))}
                  onDeleteRule={handleDeleteRule}
                />
              </div>
            )}

            {/* Individual card */}
            {!isOnBatchCard && currentItem && (
              <>
                <div
                  className={cn(
                    "relative z-20 transition-all duration-200",
                    animatingOut === "left" && "animate-swipe-left",
                    animatingOut === "right" && "animate-swipe-right",
                    animatingOut === "up" && "animate-swipe-up"
                  )}
                >
                  <TriageCard ref={cardRef} item={currentItem} isActive={true} senderItemCount={senderCounts[`${currentItem.connector}:${currentItem.sender}`] || 0} />
                </div>

                {/* Suggested tasks box */}
                {!animatingOut && (
                  <SuggestedTasksBox
                    itemId={currentItem.dbId || currentItem.id}
                    initialTasks={tasksByItemId[currentItem.dbId || currentItem.id]}
                  />
                )}
              </>
            )}
          </div>

        </div>
        )}
      </div>

      {/* Action menu overlay */}
      {viewMode === "action" && currentItem && (
        <TriageActionMenu
          item={currentItem}
          onAction={handleActionComplete}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Group picker overlay */}
      {viewMode === "group-picker" && currentItem && (
        <TriageGroupPicker
          item={currentItem}
          onSelect={async (batchType) => {
            await handleActionComplete("classify", { batchType });
          }}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Reply composer overlay */}
      {viewMode === "reply" && currentItem && (
        <TriageReplyComposer
          item={currentItem}
          userEmail={userEmail}
          onComplete={(result) => {
            if (result.wasDraft) {
              toast.success("Draft saved in Gmail");
            } else {
              toast.success("Email sent");
            }
            handleActionComplete("actioned");
          }}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Detail modal */}
      {viewMode === "detail" && currentItem && (
        <TriageDetailModal
          item={currentItem}
          onClose={handleCloseOverlay}
          onReply={() => setViewMode("reply")}
        />
      )}

      {/* Chat overlay */}
      {viewMode === "chat" && currentItem && (
        <TriageChat
          item={currentItem}
          senderItemCount={senderCounts[`${currentItem.connector}:${currentItem.sender}`] || 0}
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

      {/* Task creator panel */}
      {viewMode === "create-task" && currentItem && (
        <TaskCreatorPanel
          item={currentItem}
          onClose={handleCloseOverlay}
          onCreated={() => {
            triageCache = { data: null, timestamp: 0 };
            handleActionComplete("actioned");
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

      {/* Quick task action card overlay */}
      {viewMode === "quick-task" && quickTaskCard && (
        <QuickTaskOverlay
          card={quickTaskCard}
          onCardChange={setQuickTaskCard}
          onClose={() => { setQuickTaskCard(null); handleCloseOverlay(); }}
        />
      )}
    </AppShell>
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
    case "action-needed":
      return "Marked for action (3 days)";
    default:
      return "Action completed";
  }
}

/**
 * Quick task overlay — extracted to avoid duplicate action dispatch.
 * Single `handleAction` is shared by both ActionCard footer buttons
 * and CardContent keyboard shortcuts (Cmd+Enter).
 */
function QuickTaskOverlay({
  card,
  onCardChange,
  onClose,
}: {
  card: ActionCardData;
  onCardChange: Dispatch<SetStateAction<ActionCardData | null>>;
  onClose: () => void;
}) {
  const handleAction = useCallback(async (actionName: string, editedData?: Record<string, unknown>) => {
    if (actionName === "send" || actionName === "confirm") {
      const cardData = editedData ?? card.data;
      try {
        const res = await fetch(`/api/action-card/${card.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: cardData }),
        });
        const result = await res.json();
        if (result.status === "confirmed") {
          toast.success(result.successMessage || "Task created!", {
            action: result.result?.resultUrl ? {
              label: "Open in Linear",
              onClick: () => window.open(result.result.resultUrl, "_blank"),
            } : undefined,
          });
        } else {
          toast.error(result.result?.error || "Failed to create task");
        }
      } catch {
        toast.error("Failed to create task");
      }
      onClose();
    } else if (actionName === "cancel" || actionName === "dismiss") {
      onClose();
    }
  }, [card.id, card.data, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg">
        <ActionCard card={card} onAction={handleAction}>
          <CardContent
            card={card}
            onDataChange={(newData) => {
              onCardChange((prev) => prev ? { ...prev, data: newData } : null);
            }}
            onAction={handleAction}
          />
        </ActionCard>
      </div>
    </div>
  );
}
