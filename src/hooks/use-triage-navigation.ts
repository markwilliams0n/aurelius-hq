'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { TriageItem } from '@/components/aurelius/triage-card';

export type ConnectorFilter = 'all' | 'gmail' | 'slack' | 'linear' | 'granola';
export type TriageView = 'card' | 'list';
export type ViewMode =
  | 'triage'
  | 'action'
  | 'reply'
  | 'detail'
  | 'chat'
  | 'snooze'
  | 'create-task'
  | 'quick-task'
  | 'group-picker';

const CONNECTOR_FILTER_VALUES: ConnectorFilter[] = [
  'all',
  'gmail',
  'slack',
  'linear',
  'granola',
];

export function useTriageNavigation(
  localItems: TriageItem[],
  batchCardCount: number
) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [connectorFilter, setConnectorFilter] =
    useState<ConnectorFilter>('all');
  const [triageView, setTriageView] = useState<TriageView>('card');
  const [viewMode, setViewMode] = useState<ViewMode>('triage');
  const [returnToList, setReturnToList] = useState(false);

  // Filter items by connector
  const filteredItems = useMemo(() => {
    if (connectorFilter === 'all') return localItems;
    return localItems.filter((item) => item.connector === connectorFilter);
  }, [localItems, connectorFilter]);

  // Batch card navigation: batch cards occupy indices 0..batchCardCount-1,
  // individual items start at batchCardCount
  const isOnBatchCard = currentIndex < batchCardCount;
  const individualItemIndex = currentIndex - batchCardCount;

  // Current item (from filtered list, offset by batch card count)
  const currentItem = isOnBatchCard
    ? undefined
    : filteredItems[individualItemIndex];
  const totalCards = batchCardCount + filteredItems.length;
  const hasItems = totalCards > 0;

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [connectorFilter]);

  // Get counts per connector
  const connectorCounts = useMemo(
    () => ({
      all: localItems.length,
      gmail: localItems.filter((i) => i.connector === 'gmail').length,
      slack: localItems.filter((i) => i.connector === 'slack').length,
      linear: localItems.filter((i) => i.connector === 'linear').length,
      granola: localItems.filter((i) => i.connector === 'granola').length,
    }),
    [localItems]
  );

  // Cycle to next/prev connector filter
  const cycleConnectorFilter = useCallback(
    (reverse: boolean) => {
      const idx = CONNECTOR_FILTER_VALUES.indexOf(connectorFilter);
      const nextIdx = reverse
        ? (idx - 1 + CONNECTOR_FILTER_VALUES.length) %
          CONNECTOR_FILTER_VALUES.length
        : (idx + 1) % CONNECTOR_FILTER_VALUES.length;
      setConnectorFilter(CONNECTOR_FILTER_VALUES[nextIdx]);
    },
    [connectorFilter]
  );

  // Select connector filter by index (0-based, for Cmd+1-5)
  const selectConnectorFilter = useCallback((index: number) => {
    if (index < CONNECTOR_FILTER_VALUES.length) {
      setConnectorFilter(CONNECTOR_FILTER_VALUES[index]);
    }
  }, []);

  // Toggle card/list view
  const toggleView = useCallback(
    (
      clearSelectedIds: () => void
    ) => {
      setTriageView((prev) => (prev === 'card' ? 'list' : 'card'));
      clearSelectedIds();
      setReturnToList(false);
    },
    []
  );

  // Open a list item in card view
  const openListItem = useCallback(
    (id: string) => {
      const index = filteredItems.findIndex((i) => i.id === id);
      if (index >= 0) {
        setCurrentIndex(index + batchCardCount);
        setReturnToList(true);
        setTriageView('card');
      }
    },
    [filteredItems, batchCardCount]
  );

  // Close overlay, handling return-to-list logic
  const handleCloseOverlay = useCallback(() => {
    setViewMode('triage');
  }, []);

  return {
    currentIndex,
    setCurrentIndex,
    connectorFilter,
    setConnectorFilter,
    triageView,
    setTriageView,
    viewMode,
    setViewMode,
    returnToList,
    setReturnToList,
    filteredItems,
    currentItem,
    isOnBatchCard,
    individualItemIndex,
    totalCards,
    hasItems,
    connectorCounts,
    cycleConnectorFilter,
    selectConnectorFilter,
    toggleView,
    openListItem,
    handleCloseOverlay,
  };
}
