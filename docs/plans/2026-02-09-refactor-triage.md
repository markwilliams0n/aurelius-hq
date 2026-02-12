# Triage Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify and clean up the triage system — data model, connectors, heartbeat, classification, API routes, and UI — while preserving all functionality.

**Architecture:** Eight focused phases, each independently committable. Phases are ordered by dependency — later phases build on earlier ones. Each phase targets one of the 8 simplification areas identified in the analysis.

**Tech Stack:** Next.js 15, React 18, Drizzle ORM, PostgreSQL (Neon), SWR (new), TypeScript

---

## Phase 1: Split Heartbeat into Focused Jobs

**Why first:** This is a low-risk structural change that makes everything else easier. No behavior changes, just reorganization.

**Files:**
- Modify: `src/lib/memory/heartbeat.ts` (360 lines → ~80 lines)
- Create: `src/lib/connectors/sync-all.ts` (~60 lines)
- Create: `src/lib/connectors/types.ts` (~30 lines)
- Create: `src/lib/jobs/daily-maintenance.ts` (~50 lines)
- Modify: `src/lib/scheduler.ts`
- Modify: `src/app/api/heartbeat/route.ts`

### Step 1: Create connector types

Create `src/lib/connectors/types.ts` with shared types:

```typescript
export interface SyncResult {
  synced: number;
  errors: number;
  skipped: number;
  error?: string;
}

export interface ConnectorSyncResult {
  connector: string;
  result?: SyncResult;
  success: boolean;
  durationMs: number;
  error?: string;
}
```

### Step 2: Create `syncAllConnectors()`

Create `src/lib/connectors/sync-all.ts`. Extract the 4 connector sync calls (Granola, Gmail, Linear, Slack) from heartbeat into a standalone function. Keep the same try/catch-per-connector pattern but use a loop over a registered list instead of copy-pasted blocks.

```typescript
import { syncGranolaMeetings } from '@/lib/granola';
import { syncGmailMessages } from '@/lib/gmail';
import { syncLinearNotifications } from '@/lib/linear';
import { syncSlackMessages, startSocketMode, isSocketConfigured } from '@/lib/slack';
import { syncSlackDirectory } from '@/lib/slack/directory';
import { logConnectorSync } from '@/lib/system-events';
import type { ConnectorSyncResult } from './types';

type ProgressCallback = (connector: string, status: string, detail?: string) => void;

export interface SyncOptions {
  skip?: string[];  // connector names to skip
  onProgress?: ProgressCallback;
}

export async function syncAllConnectors(options: SyncOptions = {}): Promise<ConnectorSyncResult[]> {
  // Run each connector sequentially (they share rate limits, etc.)
  // Each wrapped in try/catch — failures don't cascade
}
```

### Step 3: Create `runDailyMaintenance()`

Create `src/lib/jobs/daily-maintenance.ts`. Extract backup + daily learning from heartbeat.

```typescript
export async function runDailyMaintenance(options?: { skipBackup?: boolean; skipLearning?: boolean }): Promise<...>
```

### Step 4: Slim down heartbeat

Rewrite `heartbeat.ts` to compose the focused jobs:

```typescript
export async function runHeartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResult> {
  const maintenance = await runDailyMaintenance({ ... });
  const syncResults = await syncAllConnectors({ ... });
  const classifyResult = await classifyNewItems();
  // Combine results into HeartbeatResult (preserve existing shape for API compat)
}
```

### Step 5: Run tests, verify TypeScript clean

```bash
npx tsc --noEmit
npx jest --passWithNoTests
```

### Step 6: Commit

```
refactor: split heartbeat into focused jobs (sync, classify, maintenance)
```

---

## Phase 2: Standardize Connector Pattern

**Why:** The 4 connectors (Gmail, Granola, Linear, Slack) each handle sync differently. Standardizing makes them easier to maintain and makes adding new connectors simpler.

**Files:**
- Create: `src/lib/connectors/index.ts` (registry)
- Create: `src/lib/connectors/gmail.ts` (adapter)
- Create: `src/lib/connectors/granola.ts` (adapter)
- Create: `src/lib/connectors/linear.ts` (adapter)
- Create: `src/lib/connectors/slack.ts` (adapter)
- Modify: `src/lib/connectors/types.ts` (add Connector interface)
- Modify: `src/lib/connectors/sync-all.ts` (use registry)

### Step 1: Define Connector interface

Add to `src/lib/connectors/types.ts`:

```typescript
export interface Connector {
  name: string;
  /** Run the sync — fetch new items from source, insert into inbox */
  sync(): Promise<SyncResult>;
  /** Optional: reconcile stale items (archive items no longer in source) */
  reconcile?(): Promise<{ reconciled: number }>;
  /** Optional: check if connector is configured/available */
  isConfigured?(): boolean;
}
```

### Step 2: Create adapter for each connector

Each adapter wraps the existing sync function with the Connector interface. **No logic changes** — just adapter pattern.

Example `src/lib/connectors/gmail.ts`:
```typescript
import { syncGmailMessages } from '@/lib/gmail';
import type { Connector, SyncResult } from './types';

export const gmailConnector: Connector = {
  name: 'gmail',
  async sync(): Promise<SyncResult> {
    const result = await syncGmailMessages();
    return { synced: result.synced, errors: result.errors, skipped: result.skipped };
  },
  // Gmail has built-in reconciliation in syncGmailMessages()
};
```

### Step 3: Create connector registry

`src/lib/connectors/index.ts`:
```typescript
import { gmailConnector } from './gmail';
import { granolaConnector } from './granola';
import { linearConnector } from './linear';
import { slackConnector } from './slack';
import type { Connector } from './types';

export const connectors: Connector[] = [
  granolaConnector,
  gmailConnector,
  linearConnector,
  slackConnector,
];

export function getConnector(name: string): Connector | undefined {
  return connectors.find(c => c.name === name);
}
```

### Step 4: Update `syncAllConnectors()` to use registry

Replace hardcoded sync calls with loop over `connectors`:

```typescript
for (const connector of connectors) {
  if (options.skip?.includes(connector.name)) continue;
  if (connector.isConfigured && !connector.isConfigured()) continue;
  // try/catch, track result, call progress...
}
```

### Step 5: Run tests, verify TypeScript clean

### Step 6: Commit

```
refactor: standardize connectors behind Connector interface
```

---

## Phase 3: Move Sync State to Database

**Why:** Sync state lives in 4 dotfiles. Moving to the configs table gives us queryability, versioning, and consistency.

**Files:**
- Create migration: `drizzle/NNNN_sync_state_to_db.sql` (add config keys)
- Modify: `src/lib/db/schema/config.ts` (add `sync:gmail`, `sync:granola`, `sync:linear`, `sync:slack` to enum)
- Create: `src/lib/connectors/sync-state.ts` (read/write sync state from DB)
- Modify: `src/lib/gmail/sync.ts` (use DB sync state)
- Modify: `src/lib/granola/sync.ts` (use DB sync state)
- Modify: `src/lib/linear/sync.ts` (use DB sync state)
- Modify: `src/lib/slack/sync.ts` (use DB sync state)

### Step 1: Add config keys via migration

```sql
ALTER TYPE config_key ADD VALUE 'sync:gmail';
ALTER TYPE config_key ADD VALUE 'sync:granola';
ALTER TYPE config_key ADD VALUE 'sync:linear';
ALTER TYPE config_key ADD VALUE 'sync:slack';
```

Update the `configKeyEnum` in `src/lib/db/schema/config.ts` to include the new values.

### Step 2: Create sync state helpers

`src/lib/connectors/sync-state.ts`:
```typescript
import { db } from '@/lib/db';
import { configs } from '@/lib/db/schema';

export async function getSyncState(connector: string): Promise<Record<string, unknown> | null> {
  // Read from configs table where key = `sync:${connector}`
}

export async function setSyncState(connector: string, state: Record<string, unknown>): Promise<void> {
  // Upsert into configs table
}
```

### Step 3: Migrate each connector to use DB sync state

For each connector, replace file reads/writes with `getSyncState()`/`setSyncState()`. The sync state shape stays the same — just the storage location changes.

**Gmail**: Replace `.gmail-sync-state.json` reads/writes
**Granola**: Replace `.granola-credentials.json` `last_synced_at` field (keep credential fields in file — those are secrets)
**Linear**: Replace `.linear-sync-state.json` reads/writes
**Slack**: Replace `.slack-sync-state.json` reads/writes

### Step 4: Seed DB from existing files (one-time migration helper)

Add a utility that reads the existing dotfiles and seeds the DB. This can run once during heartbeat if DB state is empty.

### Step 5: Run migration

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

### Step 6: Run tests, verify TypeScript clean

### Step 7: Commit

```
refactor: move connector sync state from dotfiles to database
```

---

## Phase 4: Add Rule Ordering and Dedup

**Why:** Rules have no ordering (first match is DB-order-dependent) and reclassification creates duplicate rules without checking.

**Files:**
- Create migration: `drizzle/NNNN_rule_ordering.sql`
- Modify: `src/lib/db/schema/triage.ts` (add `order` column)
- Modify: `src/lib/triage/rules.ts` (ordered fetch, dedup on create)
- Modify: `src/app/api/triage/batch/reclassify/route.ts` (upsert instead of insert)
- Modify: `src/lib/triage/__tests__/rules.test.ts` (add ordering/dedup tests)

### Step 1: Add `order` column via migration

```sql
ALTER TABLE triage_rules ADD COLUMN "order" integer DEFAULT 0;
-- Set existing rules to sequential order
UPDATE triage_rules SET "order" = subq.row_num FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as row_num FROM triage_rules
) subq WHERE triage_rules.id = subq.id;
```

### Step 2: Update schema

Add `order` column to `triageRules` in `src/lib/db/schema/triage.ts`.

### Step 3: Update `getActiveRules()` to order by `order` column

In `src/lib/triage/rules.ts`:
```typescript
export async function getActiveRules() {
  return db.select().from(triageRules)
    .where(eq(triageRules.status, 'active'))
    .orderBy(asc(triageRules.order));
}
```

### Step 4: Add dedup to reclassify

In `src/app/api/triage/batch/reclassify/route.ts`, before creating a rule, check if one already exists for that sender:
```typescript
const existing = await db.select().from(triageRules)
  .where(and(
    sql`trigger->>'sender' = ${sender}`,
    eq(triageRules.status, 'active')
  ));
if (existing.length > 0) {
  // Update existing rule's action instead of creating new one
  await updateRule(existing[0].id, { action: { type: 'batch', batchType: toBatchType } });
} else {
  // Create new rule
}
```

### Step 5: Write tests for ordering and dedup

### Step 6: Run migration, tests, verify TypeScript clean

### Step 7: Commit

```
refactor: add rule ordering and dedup on reclassify
```

---

## Phase 5: Delete Legacy Endpoints & Clean Up API

**Why:** Redundant endpoints increase surface area and confusion.

**Files:**
- Delete: `src/app/api/triage/chat/route.ts`
- Modify: `src/components/aurelius/task-creator-panel.tsx` (point to /api/chat)
- Delete: `src/app/api/triage/backfill-tasks/route.ts` (one-time maintenance, done)
- Potentially consolidate: `src/app/api/triage/[id]/memory/bulk/route.ts` into main memory route

### Step 1: Migrate task-creator-panel away from legacy chat

Update `task-creator-panel.tsx` to use the unified `/api/chat` endpoint with `context.surface = "triage"` instead of `/api/triage/chat`. Verify the AI still gets proper triage context.

### Step 2: Delete legacy chat endpoint

Remove `src/app/api/triage/chat/route.ts` entirely.

### Step 3: Delete backfill-tasks endpoint

Remove `src/app/api/triage/backfill-tasks/route.ts` — this was a one-time maintenance script.

### Step 4: Consolidate memory endpoints

Merge `src/app/api/triage/[id]/memory/bulk/route.ts` functionality into the main `src/app/api/triage/[id]/memory/route.ts` by checking the request body shape. If body has `extractedMemory`, handle bulk; otherwise handle single item.

### Step 5: Run tests, verify TypeScript clean

### Step 6: Commit

```
refactor: delete legacy triage endpoints, consolidate memory API
```

---

## Phase 6: Install SWR & Replace Manual Cache

**Why:** The module-level `triageCache` with manual invalidation is fragile and causes stale data bugs. SWR handles caching, revalidation, and optimistic updates properly.

**Files:**
- Install: `swr` package
- Create: `src/hooks/use-triage-data.ts` (~80 lines)
- Modify: `src/app/triage/triage-client.tsx` (remove cache logic, use hook)

### Step 1: Install SWR

```bash
bun add swr
```

### Step 2: Create `useTriageData` hook

`src/hooks/use-triage-data.ts`:
```typescript
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useTriageData(connectorFilter: string = 'all') {
  const params = new URLSearchParams({ status: 'new' });
  if (connectorFilter !== 'all') params.set('connector', connectorFilter);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/triage?${params}`,
    fetcher,
    {
      refreshInterval: 5 * 60 * 1000,  // 5 min stale-while-revalidate
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
    mutate,  // For cache invalidation after mutations
  };
}
```

### Step 3: Replace manual cache in triage-client

Remove the module-level `triageCache` variable, `CACHE_STALE_MS`, and `fetchItems()` function. Replace with `useTriageData()` hook. Replace all `triageCache = { data: null, timestamp: 0 }; fetchItems({ skipCache: true })` with `mutate()`.

### Step 4: Run tests (UI tests may need SWR provider mock), verify TypeScript clean

### Step 5: Commit

```
refactor: replace manual triage cache with SWR
```

---

## Phase 7: Extract Hooks from triage-client.tsx

**Why:** 1,328 lines in one component is unmaintainable. Extract focused hooks for actions, keyboard handling, and navigation.

**Files:**
- Create: `src/hooks/use-triage-actions.ts` (~150 lines)
- Create: `src/hooks/use-triage-keyboard.ts` (~120 lines)
- Create: `src/hooks/use-triage-navigation.ts` (~60 lines)
- Modify: `src/app/triage/triage-client.tsx` (target: ~400 lines)

### Step 1: Extract `useTriageActions`

Move all action handlers out: `handleArchive`, `handleSnooze`, `handleSpam`, `handleMemory`, `handleMemoryFull`, `handleActionNeeded`, `handleUndo`, `handleBatchAction`, `handleReclassify`, `handleRestore`.

The hook takes `items`, `setItems`, `mutate` (from SWR), `currentItem`, and returns the action handlers.

```typescript
export function useTriageActions(params: {
  items: TriageItem[];
  currentItem: TriageItem | null;
  mutate: () => void;
}) {
  // All action handlers here
  // Includes lastAction state + undo logic
  return { handleArchive, handleSnooze, handleSpam, handleUndo, ... };
}
```

This eliminates the `lastActionRef` hack because the ref lives inside the hook with proper closure scope.

### Step 2: Extract `useTriageKeyboard`

Move the 300-line keyboard handler into a declarative hook:

```typescript
interface KeyBinding {
  key: string;
  modifiers?: { shift?: boolean; meta?: boolean };
  scope: 'card' | 'list' | 'batch' | 'global';
  handler: () => void;
  when?: () => boolean;  // conditional activation
}

export function useTriageKeyboard(bindings: KeyBinding[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Match key + modifiers + scope + when condition
      // Call handler, prevent default
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings]);
}
```

The triage-client declares bindings as data:
```typescript
useTriageKeyboard([
  { key: 'ArrowLeft', scope: 'card', handler: actions.handleArchive },
  { key: 'ArrowUp', scope: 'card', handler: actions.handleMemory },
  { key: 'ArrowUp', scope: 'card', modifiers: { shift: true }, handler: actions.handleMemoryFull },
  // ...
]);
```

### Step 3: Extract `useTriageNavigation`

Move `currentIndex`, `connectorFilter`, `triageView`, `viewMode`, filtering logic:

```typescript
export function useTriageNavigation(items: TriageItem[]) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>('all');
  const [triageView, setTriageView] = useState<TriageView>('card');
  const [viewMode, setViewMode] = useState<ViewMode>('triage');

  const filteredItems = useMemo(() => /* filter logic */, [items, connectorFilter]);
  const currentItem = filteredItems[currentIndex] ?? null;

  return { currentIndex, setCurrentIndex, connectorFilter, setConnectorFilter,
           triageView, setTriageView, viewMode, setViewMode, filteredItems, currentItem };
}
```

### Step 4: Slim down triage-client.tsx

The main component becomes orchestration only — composing hooks and rendering layout. Target: ~400 lines.

```typescript
export function TriageClient({ userEmail }: Props) {
  const { items, stats, batchCards, mutate, isLoading } = useTriageData(connectorFilter);
  const nav = useTriageNavigation(items);
  const actions = useTriageActions({ items, currentItem: nav.currentItem, mutate });

  useTriageKeyboard([
    { key: 'ArrowLeft', scope: 'card', handler: actions.handleArchive },
    // ... declarative bindings
  ]);

  return (
    <AppShell>
      {/* Header, content area, modals — just JSX, no logic */}
    </AppShell>
  );
}
```

### Step 5: Run ALL tests (this touches the most code)

```bash
npx tsc --noEmit
npx jest
```

### Step 6: Commit

```
refactor: extract triage hooks (actions, keyboard, navigation)
```

---

## Phase 8: Clean Up Enrichment/Classification Data Model

**Why last:** This touches the data model which everything depends on. Easier after the code is cleaner from phases 1-7.

**Files:**
- Modify: `src/lib/db/schema/triage.ts`
- Create migration: `drizzle/NNNN_cleanup_enrichment.sql`
- Modify: `src/lib/triage/classify.ts`
- Modify: `src/lib/triage/classify-kimi.ts`
- Modify: `src/lib/triage/enrichment.ts`
- Modify: `src/lib/gmail/sync.ts`
- Modify: `src/lib/granola/sync.ts`
- Modify: `src/lib/triage/batch-cards.ts`
- Modify: `src/app/api/triage/route.ts`
- Modify: `src/components/aurelius/triage-card.tsx`
- Modify: Any code reading `classification.enrichment.suggestedPriority`

### Step 1: Audit current enrichment/classification overlap

The problem: priority exists in 3 places:
- `inbox_items.priority` (the actual value)
- `enrichment.suggestedPriority` (from Ollama enrichment)
- `classification.enrichment.suggestedPriority` (from Kimi classification)

And Kimi classification returns enrichment data that gets written to both columns.

### Step 2: Consolidate — Kimi enrichment writes to `enrichment` only

Modify `classify-kimi.ts`: when Kimi returns enrichment data (summary, suggestedPriority, suggestedTags), **don't** store it nested in `classification.enrichment`. Instead, merge it directly into the item's `enrichment` JSONB column.

Modify `classify.ts` `classifyNewItems()`: after classification, if the classifier returned enrichment, merge it into the item's `enrichment` column in a single update.

### Step 3: Remove `enrichment` field from `ClassificationResult` type

The classification result becomes purely about classification:
```typescript
export type ClassificationResult = {
  batchType: string | null;
  tier: "rule" | "ollama" | "kimi";
  confidence: number;
  reason: string;
  ruleId?: string;
  // NO enrichment field
};
```

Enrichment data goes directly to the `enrichment` column.

### Step 4: Add migration to clean existing data

```sql
-- Move classification.enrichment data into enrichment column where missing
UPDATE inbox_items
SET enrichment = enrichment || (classification->'enrichment')
WHERE classification->'enrichment' IS NOT NULL
  AND classification->>'tier' = 'kimi';

-- Remove enrichment key from classification JSONB
UPDATE inbox_items
SET classification = classification - 'enrichment'
WHERE classification ? 'enrichment';
```

### Step 5: Update all code that reads `classification.enrichment`

Search for `classification.enrichment` or `classification?.enrichment` and update to read from `enrichment` directly.

### Step 6: Run tests, verify TypeScript clean

### Step 7: Commit

```
refactor: consolidate enrichment data, remove classification.enrichment overlap
```

---

## Verification Checklist (After All Phases)

After completing all 8 phases, verify:

1. **`npx tsc --noEmit`** — TypeScript clean
2. **`npx jest`** — All tests pass (261+)
3. **Manual smoke test:**
   - Trigger heartbeat via System page → all connectors sync
   - Triage page loads, batch cards appear
   - Archive an item (← key) → syncs to Gmail
   - Reclassify an item (g key) → rule created (check no dups)
   - Open triage chat (Space key) → conversation works
   - Snooze an item (s key) → returns after time
   - Undo (Cmd+Z) → item restored
4. **`triage-client.tsx`** is under 500 lines
5. **`heartbeat.ts`** is under 100 lines
6. **No `.xxx-sync-state.json` files read at runtime** (can keep for backup)
7. **No `/api/triage/chat` endpoint**
8. **Rules have `order` column**, reclassify deduplicates

---

## File Impact Summary

**New files (10):**
- `src/lib/connectors/types.ts`
- `src/lib/connectors/index.ts`
- `src/lib/connectors/sync-all.ts`
- `src/lib/connectors/gmail.ts`, `granola.ts`, `linear.ts`, `slack.ts`
- `src/lib/connectors/sync-state.ts`
- `src/lib/jobs/daily-maintenance.ts`
- `src/hooks/use-triage-data.ts`
- `src/hooks/use-triage-actions.ts`
- `src/hooks/use-triage-keyboard.ts`
- `src/hooks/use-triage-navigation.ts`

**Deleted files (3):**
- `src/app/api/triage/chat/route.ts`
- `src/app/api/triage/backfill-tasks/route.ts`
- `src/app/api/triage/[id]/memory/bulk/route.ts` (merged into parent)

**Significantly modified (5):**
- `src/lib/memory/heartbeat.ts` (360 → ~80 lines)
- `src/app/triage/triage-client.tsx` (1328 → ~400 lines)
- `src/lib/triage/classify.ts` (enrichment separation)
- `src/lib/triage/classify-kimi.ts` (enrichment separation)
- `src/lib/triage/rules.ts` (ordering + dedup)

**New migrations (3):**
- Sync state config keys
- Rule ordering column
- Classification enrichment cleanup
