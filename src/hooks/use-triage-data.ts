'use client';

import useSWR from 'swr';
import type { TriageItem } from '@/components/aurelius/triage-card';
import type { BatchCardWithItems } from '@/lib/triage/batch-cards';
import type { SuggestedTask } from '@/lib/db/schema/tasks';
import type { TriageRule } from '@/lib/db/schema/triage';

/** JSON-serialized rule (Date fields become strings over the API boundary) */
export type SerializedTriageRule = Omit<TriageRule, 'createdAt' | 'updatedAt' | 'lastMatchedAt'> & {
  createdAt: string;
  updatedAt: string;
  lastMatchedAt: string | null;
};

/** JSON-serialized task (Date fields become strings over the API boundary) */
type SerializedTask = Omit<SuggestedTask, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export interface TriageData {
  items: TriageItem[];
  stats: { new: number; archived: number; snoozed: number; actioned: number };
  batchCards: BatchCardWithItems[];
  tasksByItemId: Record<string, SerializedTask[]>;
  senderCounts: Record<string, number>;
}

export interface TriageRulesData {
  rules: SerializedTriageRule[];
}

const triageFetcher = async (url: string): Promise<TriageData> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch triage data');
  const data = await res.json();

  // Apply the same ID transformation that the old fetchItems() did:
  // items: remap id -> dbId, externalId -> id
  const items = (data.items || []).map((item: TriageItem & { externalId?: string }) => ({
    ...item,
    dbId: item.id,
    id: item.externalId || item.id,
  }));

  return {
    items,
    stats: data.stats || { new: 0, archived: 0, snoozed: 0, actioned: 0 },
    batchCards: data.batchCards || [],
    tasksByItemId: data.tasksByItemId || {},
    senderCounts: data.senderCounts || {},
  };
};

const rulesFetcher = async (url: string): Promise<TriageRulesData> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch triage rules');
  const data = await res.json();
  return { rules: data.rules || [] };
};

export function useTriageData() {
  const { data, error, isLoading, mutate } = useSWR<TriageData>(
    '/api/triage',
    triageFetcher,
    {
      refreshInterval: 5 * 60 * 1000, // 5 min auto-revalidation
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    }
  );

  return {
    items: data?.items ?? [],
    stats: data?.stats ?? { new: 0, archived: 0, snoozed: 0, actioned: 0 },
    batchCards: data?.batchCards ?? [],
    tasksByItemId: data?.tasksByItemId ?? {},
    senderCounts: data?.senderCounts ?? {},
    isLoading,
    error,
    mutate,
  };
}

export function useTriageRules() {
  const { data, error, isLoading, mutate } = useSWR<TriageRulesData>(
    '/api/triage/rules',
    rulesFetcher,
    {
      refreshInterval: 5 * 60 * 1000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    triageRules: data?.rules ?? [],
    rulesError: error,
    rulesLoading: isLoading,
    mutateRules: mutate,
  };
}
