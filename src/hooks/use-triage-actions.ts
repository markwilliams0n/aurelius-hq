'use client';

import { useState, useCallback, useRef } from 'react';
import type { TriageItem } from '@/components/aurelius/triage-card';
import type { ActionCardData } from '@/lib/types/action-card';
import type { ViewMode } from '@/hooks/use-triage-navigation';
import { toast } from 'sonner';

interface UseTriageActionsParams {
  localItems: TriageItem[];
  setLocalItems: React.Dispatch<React.SetStateAction<TriageItem[]>>;
  currentItem: TriageItem | undefined;
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  filteredItems: TriageItem[];
  setViewMode: (mode: ViewMode) => void;
  setAnimatingOut: React.Dispatch<React.SetStateAction<'left' | 'right' | 'up' | null>>;
  mutate: () => void;
  mutateRules: () => void;
}

// Connector action availability
const CONNECTOR_ACTIONS: Record<
  string,
  {
    canReply: boolean;
    canArchive: boolean;
    canAddToMemory: boolean;
    canTakeActions: boolean;
    canChat: boolean;
  }
> = {
  gmail: { canReply: true, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  slack: { canReply: true, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  linear: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  granola: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
  manual: { canReply: false, canArchive: true, canAddToMemory: true, canTakeActions: true, canChat: true },
};

function getActionMessage(action: string): string {
  switch (action) {
    case 'archive': return 'Archived';
    case 'snooze': return 'Snoozed';
    case 'flag': return 'Flagged';
    case 'priority': return 'Priority updated';
    case 'tag': return 'Tag added';
    case 'actioned': return 'Marked as done';
    case 'action-needed': return 'Marked for action (3 days)';
    default: return 'Action completed';
  }
}

export function useTriageActions({
  localItems,
  setLocalItems,
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
}: UseTriageActionsParams) {
  const [lastAction, setLastAction] = useState<{
    type: string;
    itemId: string;
    item: TriageItem;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [quickTaskCard, setQuickTaskCard] = useState<ActionCardData | null>(null);

  const lastActionRef = useRef<{ type: string; itemId: string; item: TriageItem } | null>(null);
  const bulkUndoRef = useRef<TriageItem[]>([]);

  // Keep ref in sync with state
  const updateLastAction = useCallback(
    (action: { type: string; itemId: string; item: TriageItem } | null) => {
      setLastAction(action);
      lastActionRef.current = action;
    },
    []
  );

  // Undo last action
  const handleUndo = useCallback(() => {
    const action = lastActionRef.current;
    if (!action) return;

    if (action.type === 'bulk-archive') {
      const itemsToRestore = bulkUndoRef.current;
      setLocalItems((prev) => [...itemsToRestore, ...prev]);
      setCurrentIndex(0);

      itemsToRestore.forEach((item) => {
        const restoreId = item.dbId || item.id;
        fetch(`/api/triage/${restoreId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore' }),
        }).catch(console.error);
      });

      bulkUndoRef.current = [];
    } else {
      let itemToRestore = action.item;

      if (action.type === 'action-needed' && itemToRestore.enrichment) {
        const { actionNeededDate, ...restEnrichment } =
          itemToRestore.enrichment as Record<string, unknown>;
        itemToRestore = { ...itemToRestore, enrichment: restEnrichment };
      }

      setLocalItems((prev) => [itemToRestore, ...prev]);
      setCurrentIndex(0);

      const restoreId = action.item.dbId || action.itemId;
      fetch(`/api/triage/${restoreId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', previousAction: action.type }),
      }).catch((error) => {
        console.error('Failed to restore:', error);
        toast.error('Failed to restore on server');
      });
    }

    updateLastAction(null);
    toast.success('Restored');
  }, [setLocalItems, setCurrentIndex, updateLastAction]);

  // Show proposal toast when triage API suggests a rule
  const showProposalToast = useCallback((proposal: {
    id: string;
    type: string;
    ruleText: string;
    sender: string;
    senderName: string | null;
    evidence: { bulk?: number; quick?: number; engaged?: number; total?: number; overrideCount?: number };
  }) => {
    const displayName = proposal.senderName || proposal.sender;
    const ev = proposal.evidence;

    let message: string;
    if (proposal.type === "archive") {
      message = `You've archived ${ev.total}/${ev.total} from ${displayName} — always archive?`;
    } else {
      if (ev.overrideCount) {
        message = `You overrode archive for ${displayName} ${ev.overrideCount} times — always surface?`;
      } else {
        message = `You engaged with ${ev.engaged}/${ev.total} from ${displayName} — always surface?`;
      }
    }

    toast(message, {
      duration: 10000,
      action: {
        label: "Yes",
        onClick: () => {
          fetch(`/api/triage/rules/${proposal.id}/accept`, { method: "POST" })
            .then(() => {
              toast.success("Rule created");
              mutateRules();
            })
            .catch(() => toast.error("Failed to create rule"));
        },
      },
      cancel: {
        label: "Not yet",
        onClick: () => {
          fetch(`/api/triage/rules/${proposal.id}/dismiss`, { method: "POST" }).catch(() => {});
        },
      },
    });
  }, [mutateRules]);

  // Archive action (ArrowLeft)
  const handleArchive = useCallback(() => {
    if (!currentItem) return;

    const itemToArchive = currentItem;
    const apiId = itemToArchive.dbId || itemToArchive.id;
    setAnimatingOut('left');
    updateLastAction({ type: 'archive', itemId: itemToArchive.id, item: itemToArchive });

    fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.proposal) {
          showProposalToast(data.proposal);
        }
      })
      .catch((error) => {
        console.error('Failed to archive:', error);
        toast.error('Failed to archive - item restored');
        setLocalItems((prev) => [itemToArchive, ...prev]);
      });

    setTimeout(() => {
      setLocalItems((prev) => prev.filter((i) => i.id !== itemToArchive.id));
      setAnimatingOut(null);
    }, 150);

    toast.success('Archived', {
      action: { label: 'Undo', onClick: () => handleUndo() },
    });
  }, [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo, showProposalToast]);

  // Quick archive action (Shift+ArrowLeft)
  const handleQuickArchive = useCallback(() => {
    if (!currentItem) return;

    const itemToArchive = currentItem;
    const apiId = itemToArchive.dbId || itemToArchive.id;
    setAnimatingOut('left');
    updateLastAction({ type: 'archive', itemId: itemToArchive.id, item: itemToArchive });

    fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', triagePath: 'quick' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.proposal) showProposalToast(data.proposal);
      })
      .catch((error) => {
        console.error('Failed to archive:', error);
        toast.error('Failed to archive - item restored');
        setLocalItems((prev) => [itemToArchive, ...prev]);
      });

    setTimeout(() => {
      setLocalItems((prev) => prev.filter((i) => i.id !== itemToArchive.id));
      setAnimatingOut(null);
    }, 150);

    toast.success('Archived', {
      action: { label: 'Undo', onClick: () => handleUndo() },
    });
  }, [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo, showProposalToast]);

  // Memory summary (ArrowUp)
  const handleMemory = useCallback(async () => {
    if (!currentItem) return;

    const apiId = currentItem.dbId || currentItem.id;
    fetch(`/api/triage/${apiId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'summary' }),
    }).catch((error) => {
      console.error('Failed to queue memory save:', error);
    });

    toast.success('Summarizing to memory...', {
      description: 'Ollama summary -> Supermemory',
    });
  }, [currentItem]);

  // Memory full (Shift+ArrowUp)
  const handleMemoryFull = useCallback(async () => {
    if (!currentItem) return;

    const apiId = currentItem.dbId || currentItem.id;
    fetch(`/api/triage/${apiId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'full' }),
    }).catch((error) => {
      console.error('Failed to queue memory save:', error);
    });

    toast.success('Saving full to memory...', {
      description: 'Full content -> Supermemory',
    });
  }, [currentItem]);

  // Open action menu (ArrowRight)
  const handleOpenActions = useCallback(() => {
    if (!currentItem) return;
    setViewMode('action');
  }, [currentItem, setViewMode]);

  // Open reply composer (ArrowDown)
  const handleOpenReply = useCallback(() => {
    if (!currentItem) return;
    const actions = CONNECTOR_ACTIONS[currentItem.connector];
    if (!actions?.canReply) {
      toast.info('Reply not available', {
        description: `${currentItem.connector} items don't support direct replies`,
      });
      return;
    }
    setViewMode('reply');
  }, [currentItem, setViewMode]);

  // Open detail view (Enter)
  const handleOpenDetail = useCallback(() => {
    if (!currentItem) return;
    setViewMode('detail');
  }, [currentItem, setViewMode]);

  // Open chat (Space)
  const handleOpenChat = useCallback(() => {
    if (!currentItem) return;
    setViewMode('chat');
  }, [currentItem, setViewMode]);

  // Open snooze menu (s)
  const handleOpenSnooze = useCallback(() => {
    if (!currentItem) return;
    setViewMode('snooze');
  }, [currentItem, setViewMode]);

  // Action Needed (a) - 3-day snooze + Gmail label
  const handleActionNeeded = useCallback(
    async (targetItem?: TriageItem) => {
      const itemToAction = targetItem || currentItem;
      if (!itemToAction) return;

      if (itemToAction.connector !== 'gmail') {
        toast.info('Action Needed is only available for Gmail items');
        return;
      }

      const apiId = itemToAction.dbId || itemToAction.id;
      setAnimatingOut('right');
      updateLastAction({
        type: 'action-needed',
        itemId: itemToAction.id,
        item: itemToAction,
      });

      try {
        fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
        const res = await fetch(`/api/triage/${apiId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'action-needed' }),
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
      } catch (error) {
        console.error('Failed to mark action needed:', error);
        toast.error('Failed to mark for action - item restored');
        setAnimatingOut(null);
        return;
      }

      setLocalItems((prev) => prev.filter((i) => i.id !== itemToAction.id));
      setAnimatingOut(null);

      toast.success('Marked for action (3 days)', {
        action: { label: 'Undo', onClick: () => handleUndo() },
      });
    },
    [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo]
  );

  // Spam action (x)
  const handleSpam = useCallback(() => {
    if (!currentItem) return;

    const itemToSpam = currentItem;
    const apiId = itemToSpam.dbId || itemToSpam.id;
    setAnimatingOut('left');
    updateLastAction({ type: 'spam', itemId: itemToSpam.id, item: itemToSpam });

    fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
    fetch(`/api/triage/${apiId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'spam' }),
    }).catch((error) => {
      console.error('Failed to mark as spam:', error);
      toast.error('Failed to mark as spam - item restored');
      setLocalItems((prev) => [itemToSpam, ...prev]);
    });

    setTimeout(() => {
      setLocalItems((prev) => prev.filter((i) => i.id !== itemToSpam.id));
      setAnimatingOut(null);
    }, 150);

    toast.success('Marked as spam', {
      action: { label: 'Undo', onClick: () => handleUndo() },
    });
  }, [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo]);

  // Handle snooze selection
  const handleSnooze = useCallback(
    (until: Date) => {
      if (!currentItem) return;

      const itemToSnooze = currentItem;
      const apiId = itemToSnooze.dbId || itemToSnooze.id;
      setViewMode('triage');
      setAnimatingOut('right');
      updateLastAction({
        type: 'snooze',
        itemId: itemToSnooze.id,
        item: itemToSnooze,
      });

      fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
      fetch(`/api/triage/${apiId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', snoozeUntil: until.toISOString() }),
      }).catch((error) => {
        console.error('Failed to snooze:', error);
        toast.error('Failed to snooze - item restored');
        setLocalItems((prev) => [itemToSnooze, ...prev]);
      });

      setTimeout(() => {
        setLocalItems((prev) => prev.filter((i) => i.id !== itemToSnooze.id));
        setAnimatingOut(null);
      }, 150);

      toast.success(
        `Snoozed until ${until.toLocaleDateString()} ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        { action: { label: 'Undo', onClick: () => handleUndo() } }
      );
    },
    [currentItem, setViewMode, setAnimatingOut, updateLastAction, setLocalItems, handleUndo]
  );

  // Action from menu (classify, create-task, actioned, etc.)
  const handleActionComplete = useCallback(
    async (action: string, data?: Record<string, unknown>) => {
      if (!currentItem) return;

      if (action === 'create-task') {
        setViewMode('create-task');
        return;
      }

      if (action === 'classify' && data?.batchType) {
        try {
          const res = await fetch('/api/triage/batch/reclassify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              itemId: currentItem.dbId || currentItem.id,
              fromBatchType: 'individual',
              toBatchType: data.batchType,
              sender: currentItem.sender,
              senderName: currentItem.senderName,
              connector: currentItem.connector,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            console.error('Classify API error:', res.status, errBody);
            throw new Error((errBody as { error?: string }).error || 'Classify failed');
          }

          setAnimatingOut('right');
          await new Promise((resolve) => setTimeout(resolve, 200));
          setLocalItems((prev) => prev.filter((i) => i.id !== currentItem.id));
          setAnimatingOut(null);
          toast.success(`Classified as ${data.batchType} -- rule created`);
        } catch (error) {
          console.error('Classify failed:', error);
          toast.error('Failed to classify item');
        }
        setViewMode('triage');
        return;
      }

      const apiId = currentItem.dbId || currentItem.id;
      try {
        await fetch(`/api/triage/${apiId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...data }),
        });

        if (action === 'snooze' || action === 'actioned') {
          setAnimatingOut('right');
          await new Promise((resolve) => setTimeout(resolve, 200));
          setLocalItems((prev) => prev.filter((i) => i.id !== currentItem.id));
          setAnimatingOut(null);
        }

        toast.success(getActionMessage(action));
      } catch (error) {
        console.error(`Failed to perform ${action}:`, error);
        toast.error(`Failed to ${action}`);
      }

      setViewMode('triage');
    },
    [currentItem, setViewMode, setAnimatingOut, setLocalItems]
  );

  // Delete a triage rule
  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await fetch(`/api/triage/rules/${ruleId}`, { method: 'DELETE' });
        mutateRules();
        toast.success('Rule deleted');
      } catch (error) {
        console.error('Failed to delete rule:', error);
        toast.error('Failed to delete rule');
      }
    },
    [mutateRules]
  );

  // Rule input handler
  const handleRuleInput = useCallback(
    async (input: string) => {
      try {
        await fetch('/api/triage/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, source: 'user_chat' }),
        });
        mutateRules();
        toast.success('Rule created from your input');
      } catch (error) {
        console.error('Failed to create rule:', error);
        toast.error('Failed to create rule');
      }
    },
    [mutateRules]
  );

  // Sync all connectors
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    toast.info('Syncing connectors...');

    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'manual' }),
    })
      .then(() => {
        mutate();
        mutateRules();
        toast.success('Sync complete');
        setIsSyncing(false);
      })
      .catch((error) => {
        console.error('Sync failed:', error);
        toast.error('Sync failed');
        setIsSyncing(false);
      });

    await mutate();
  }, [isSyncing, mutate, mutateRules]);

  // Shared bulk archive logic — archives items and supports undo
  const bulkArchiveItems = useCallback((itemsToArchive: TriageItem[]) => {
    if (itemsToArchive.length === 0) return;

    const count = itemsToArchive.length;

    updateLastAction({
      type: 'bulk-archive',
      itemId: itemsToArchive[0].id,
      item: itemsToArchive[0],
    });
    bulkUndoRef.current = itemsToArchive;

    const idsSet = new Set(itemsToArchive.map((i) => i.id));
    setLocalItems((prev) => prev.filter((i) => !idsSet.has(i.id)));
    setSelectedIds(new Set());

    itemsToArchive.forEach((item) => {
      const apiId = item.dbId || item.id;
      fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
      fetch(`/api/triage/${apiId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', triagePath: 'bulk' }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.proposal) showProposalToast(data.proposal);
        })
        .catch(console.error);
    });

    toast.success(`Archived ${count} item${count === 1 ? '' : 's'}`, {
      action: { label: 'Undo', onClick: () => handleUndo() },
    });
  }, [handleUndo, updateLastAction, setLocalItems, setSelectedIds, showProposalToast]);

  // Bulk archive selected items (list view)
  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const itemsToArchive = localItems.filter((i) => selectedIds.has(i.id));
    bulkArchiveItems(itemsToArchive);
  }, [selectedIds, localItems, bulkArchiveItems]);

  // Bulk archive explicit items (tier view)
  const handleBulkArchiveItems = useCallback((items: TriageItem[]) => {
    bulkArchiveItems(items);
  }, [bulkArchiveItems]);

  // Skip from archive — move item from archive tier to review tier
  const handleSkipFromArchive = useCallback(async (item: TriageItem) => {
    const apiId = item.dbId || item.id;
    try {
      // Optimistically update local items
      setLocalItems((prev) =>
        prev.map((i) => {
          if (i.id !== item.id) return i;
          const existing = (i as any).classification || {};
          return {
            ...i,
            classification: { ...existing, recommendation: "review", confidence: Math.min(existing.confidence || 0, 0.85) },
          } as any;
        })
      );

      const res = await fetch(`/api/triage/${apiId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classification: {
            ...((item as any).classification || {}),
            recommendation: "review",
            confidence: Math.min(((item as any).classification?.confidence || 0), 0.85),
          },
        }),
      });
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      toast.error("Failed to move item");
      mutate(); // Revert optimistic update
    }
  }, [setLocalItems, mutate]);

  // Quick task handler (t key)
  const handleQuickTask = useCallback(() => {
    if (!currentItem) return;
    const taskApiId = currentItem.dbId || currentItem.id;
    fetch(`/api/triage/${taskApiId}/quick-task`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.card) {
          setQuickTaskCard(data.card);
          setViewMode('quick-task');
        } else {
          toast.error(data.error || 'Failed to create task card');
        }
      })
      .catch(() => toast.error('Failed to create task card'));
  }, [currentItem, setViewMode]);

  // Open Linear URL for Linear items (l/L key)
  const handleOpenLinear = useCallback(() => {
    if (currentItem?.connector === 'linear') {
      const linearUrl = (currentItem.enrichment as Record<string, unknown>)
        ?.linearUrl as string | undefined;
      if (linearUrl) {
        window.open(linearUrl, '_blank', 'noopener,noreferrer');
        return true;
      }
    }
    return false;
  }, [currentItem]);

  return {
    // State
    lastAction,
    isSyncing,
    quickTaskCard,
    setQuickTaskCard,

    // Individual item actions
    handleArchive,
    handleQuickArchive,
    handleMemory,
    handleMemoryFull,
    handleOpenActions,
    handleOpenReply,
    handleOpenDetail,
    handleOpenChat,
    handleOpenSnooze,
    handleActionNeeded,
    handleSpam,
    handleSnooze,
    handleActionComplete,
    handleUndo,
    handleQuickTask,
    handleOpenLinear,

    // Rule actions
    handleDeleteRule,
    handleRuleInput,

    // Other
    handleSync,
    handleBulkArchive,
    handleBulkArchiveItems,
    handleSkipFromArchive,
  };
}
