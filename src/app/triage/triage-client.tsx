"use client";

import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction, useMemo } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { TriageCard } from "@/components/aurelius/triage-card";
import type { TriageItem } from "@/components/aurelius/triage-card";
import { TriageBatchCard } from "@/components/aurelius/triage-batch-card";
import { TriageEmailTiers } from "@/components/aurelius/triage-email-tiers";
import { TriageListView } from "@/components/aurelius/triage-list-view";
import type { BatchCardWithItems } from "@/lib/triage/batch-cards";
import { useTriageData, useTriageRules } from "@/hooks/use-triage-data";
import { useTriageNavigation } from "@/hooks/use-triage-navigation";
import { useTriageActions } from "@/hooks/use-triage-actions";
import { useTriageKeyboard } from "@/hooks/use-triage-keyboard";
import type { KeyBinding } from "@/hooks/use-triage-keyboard";
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
  Inbox,
  Mail,
  CalendarDays,
  RefreshCw,
  LayoutGrid,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CONNECTOR_FILTERS: Array<{
  value: "gmail" | "granola";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "gmail", label: "Email", icon: Mail },
  { value: "granola", label: "Meetings", icon: CalendarDays },
];

export function TriageClient({ userEmail }: { userEmail?: string }) {
  // SWR-managed data
  const {
    items: fetchedItems,
    stats,
    batchCards: fetchedBatchCards,
    tasksByItemId,
    senderCounts,
    isLoading,
    mutate,
  } = useTriageData();
  const { triageRules, mutateRules } = useTriageRules();

  // Local state for optimistic updates (synced from SWR)
  const [localItems, setLocalItems] = useState<TriageItem[]>([]);
  const [localBatchCards, setLocalBatchCards] = useState<BatchCardWithItems[]>([]);

  useEffect(() => {
    if (fetchedItems.length > 0 || !isLoading) {
      setLocalItems(fetchedItems);
    }
  }, [fetchedItems, isLoading]);

  useEffect(() => {
    if (fetchedBatchCards.length > 0 || !isLoading) {
      setLocalBatchCards(fetchedBatchCards);
    }
  }, [fetchedBatchCards, isLoading]);

  // UI-only local state
  const [animatingOut, setAnimatingOut] = useState<"left" | "right" | "up" | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const cardRef = useRef<HTMLDivElement>(null);

  const sidebarWidth = isSidebarExpanded ? 480 : 320;
  const batchCardCount = localBatchCards.length;

  // Navigation hook
  const nav = useTriageNavigation(localItems, batchCardCount);
  const {
    currentIndex, setCurrentIndex,
    connectorFilter, setConnectorFilter,
    triageView, setTriageView,
    viewMode, setViewMode,
    returnToList, setReturnToList,
    filteredItems, currentItem,
    isOnBatchCard, individualItemIndex,
    totalCards, hasItems,
    connectorCounts,
    cycleConnectorFilter,
    selectConnectorFilter,
    openListItem,
    handleCloseOverlay,
  } = nav;

  const currentBatchCard = isOnBatchCard ? localBatchCards[currentIndex] : null;
  const progress = hasItems ? `${currentIndex + 1} / ${totalCards}` : "0 / 0";

  // Actions hook
  const actions = useTriageActions({
    localItems,
    setLocalItems,
    localBatchCards,
    setLocalBatchCards,
    currentItem,
    currentIndex,
    setCurrentIndex,
    selectedIds,
    setSelectedIds,
    filteredItems,
    setViewMode,
    setAnimatingOut,
    mutate,
    mutateRules,
  });

  // List view handlers
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredItems.map((i) => i.id)));
  }, [filteredItems]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Keyboard bindings
  const isCardTriage = triageView === "card" && viewMode === "triage";
  const isIndividualCard = isCardTriage && !isOnBatchCard;

  const keyBindings: KeyBinding[] = useMemo(() => [
    // Escape — complex multi-branch handler
    {
      key: "Escape",
      handler: () => {
        if (viewMode !== "triage") {
          if (returnToList) {
            setReturnToList(false);
            setTriageView("list");
            setViewMode("triage");
            return;
          }
          handleCloseOverlay();
          return;
        }
        if (returnToList && triageView === "card") {
          setReturnToList(false);
          setTriageView("list");
        }
      },
      preventDefault: false,
    },

    // Tab cycles connector filters (global)
    { key: "Tab", handler: () => cycleConnectorFilter(false) },
    { key: "Tab", modifiers: { shift: true }, handler: () => cycleConnectorFilter(true) },

    // Cmd+1-2 selects connector filters (global)
    { key: "1", modifiers: { meta: true }, handler: () => selectConnectorFilter(0) },
    { key: "2", modifiers: { meta: true }, handler: () => selectConnectorFilter(1) },
    // Ctrl variants for non-Mac
    { key: "1", modifiers: { ctrl: true }, handler: () => selectConnectorFilter(0) },
    { key: "2", modifiers: { ctrl: true }, handler: () => selectConnectorFilter(1) },

    // Toggle card/list view (v) — only in triage mode
    {
      key: "v",
      handler: () => {
        setTriageView((prev) => (prev === "card" ? "list" : "card"));
        setSelectedIds(new Set());
        setReturnToList(false);
      },
      when: () => viewMode === "triage",
    },

    // Card view individual item actions
    { key: "ArrowLeft", handler: actions.handleArchive, when: () => isIndividualCard },
    { key: "ArrowUp", handler: actions.handleMemory, when: () => isIndividualCard },
    { key: "ArrowUp", modifiers: { shift: true }, handler: actions.handleMemoryFull, when: () => isIndividualCard },
    { key: "ArrowRight", handler: actions.handleOpenActions, when: () => isIndividualCard },
    { key: "ArrowDown", handler: actions.handleOpenReply, when: () => isIndividualCard },
    { key: "Enter", handler: actions.handleOpenDetail, when: () => isIndividualCard },
    { key: " ", handler: actions.handleOpenChat, when: () => isIndividualCard },
    { key: "s", handler: actions.handleOpenSnooze, when: () => isIndividualCard },
    { key: "x", handler: actions.handleSpam, when: () => isIndividualCard },
    { key: "t", handler: actions.handleQuickTask, when: () => isIndividualCard },
    { key: "a", handler: actions.handleActionNeeded, when: () => isIndividualCard },
    { key: "g", handler: () => setViewMode("group-picker"), when: () => isIndividualCard },

    // Open in Linear (l/L) — only for Linear items with URL
    {
      key: "l",
      handler: () => { actions.handleOpenLinear(); },
      when: () => isIndividualCard && currentItem?.connector === "linear",
    },
    {
      key: "L",
      modifiers: { shift: true },
      handler: () => { actions.handleOpenLinear(); },
      when: () => isIndividualCard && currentItem?.connector === "linear",
    },

    // Undo (Cmd+Z and Cmd+U)
    { key: "z", modifiers: { meta: true }, handler: actions.handleUndo },
    { key: "u", modifiers: { meta: true }, handler: actions.handleUndo },
    { key: "z", modifiers: { ctrl: true }, handler: actions.handleUndo },
    { key: "u", modifiers: { ctrl: true }, handler: actions.handleUndo },
  ], [
    viewMode, triageView, returnToList, isCardTriage, isIndividualCard,
    currentItem, cycleConnectorFilter, selectConnectorFilter,
    setTriageView, setReturnToList, setViewMode, handleCloseOverlay,
    actions,
  ]);

  useTriageKeyboard(keyBindings);

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
                await mutate();
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
                onClick={actions.handleSync}
                disabled={actions.isSyncing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                title="Sync all connectors"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", actions.isSyncing && "animate-spin")} />
                {actions.isSyncing ? "Syncing..." : "Sync"}
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

        {/* Empty state */}
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
            onBulkArchive={actions.handleBulkArchive}
            onOpenItem={openListItem}
            onActionNeeded={actions.handleActionNeeded}
          />
        )}

        {/* Email tier layout (gmail tab) */}
        {!isLoading && hasItems && connectorFilter === "gmail" && triageView === "card" && (
          <TriageEmailTiers
            items={filteredItems}
            tasksByItemId={tasksByItemId}
            onArchive={(item) => {
              const apiId = item.dbId || item.id;
              fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
              fetch(`/api/triage/${apiId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "archive" }),
              }).catch(console.error);
              setLocalItems((prev) => prev.filter((i) => i.id !== item.id));
            }}
            onBulkArchive={(itemsToArchive) => {
              for (const item of itemsToArchive) {
                const apiId = item.dbId || item.id;
                fetch(`/api/triage/${apiId}/tasks`, { method: "DELETE" }).catch(() => {});
                fetch(`/api/triage/${apiId}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "archive" }),
                }).catch(console.error);
              }
              const ids = new Set(itemsToArchive.map((i) => i.id));
              setLocalItems((prev) => prev.filter((i) => !ids.has(i.id)));
              toast.success(`Archived ${itemsToArchive.length} email${itemsToArchive.length === 1 ? "" : "s"}`);
            }}
            onSelectItem={(item) => {
              const index = filteredItems.findIndex((i) => i.id === item.id);
              if (index >= 0) nav.setCurrentIndex(index + batchCardCount);
            }}
            activeItemId={currentItem?.id}
          />
        )}

        {/* Card area (meetings tab) */}
        {!isLoading && hasItems && connectorFilter === "granola" && triageView === "card" && (
        <div className="flex-1 flex items-start justify-center pt-12 p-6 relative overflow-y-auto">
          {/* Card stack effect */}
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
                  onAction={actions.handleBatchAction}
                  onRuleInput={actions.handleRuleInput}
                  onReclassify={actions.handleReclassify}
                  rules={triageRules.filter((r) => r.action?.batchType === (currentBatchCard.data?.batchType as string))}
                  onDeleteRule={actions.handleDeleteRule}
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
          onAction={actions.handleActionComplete}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Group picker overlay */}
      {viewMode === "group-picker" && currentItem && (
        <TriageGroupPicker
          item={currentItem}
          onSelect={async (batchType) => {
            await actions.handleActionComplete("classify", { batchType });
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
            actions.handleActionComplete("actioned");
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
          onAction={(action) => {
            if (action === "snooze") {
              actions.handleActionComplete("snoozed");
            } else if (action === "archive") {
              actions.handleActionComplete("archived");
            }
          }}
        />
      )}

      {/* Task creator panel */}
      {viewMode === "create-task" && currentItem && (
        <TaskCreatorPanel
          item={currentItem}
          onClose={handleCloseOverlay}
          onCreated={() => {
            mutate();
            actions.handleActionComplete("actioned");
          }}
        />
      )}

      {/* Snooze menu overlay */}
      {viewMode === "snooze" && currentItem && (
        <TriageSnoozeMenu
          onSnooze={actions.handleSnooze}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Quick task action card overlay */}
      {viewMode === "quick-task" && actions.quickTaskCard && (
        <QuickTaskOverlay
          card={actions.quickTaskCard}
          onCardChange={actions.setQuickTaskCard}
          onClose={() => { actions.setQuickTaskCard(null); handleCloseOverlay(); }}
        />
      )}
    </AppShell>
  );
}

/**
 * Quick task overlay -- extracted to avoid duplicate action dispatch.
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
