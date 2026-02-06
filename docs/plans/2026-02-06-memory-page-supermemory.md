# Memory Page → Supermemory Dashboard

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the stale entity browser with a Supermemory dashboard showing real stats, memory browser, profile facts, and keep the debug feed.

**Architecture:** New API route `/api/memory/supermemory` wraps the SDK's `memories.list()` and `profile()` calls. The page gets three tabs: Overview (stats + profile), Memories (paginated list + search), and Debug Feed (kept as-is). Remove old entity browser component, old `/api/memory` route (PARA filesystem counts), old `/api/memory/browse` route, old `/api/memory/[factId]` route, and `getAllMemory()` from search.ts.

**Tech Stack:** Next.js App Router, Supermemory TypeScript SDK, Tailwind CSS, existing UI components (AppShell, Card, etc.)

---

### Task 1: Add Supermemory API route

**Files:**
- Create: `src/app/api/memory/supermemory/route.ts`
- Modify: `src/lib/memory/supermemory.ts` (add `listMemories` and `getProfile` exports)

**Step 1: Add SDK wrapper functions**

Add to `src/lib/memory/supermemory.ts`:

```typescript
/**
 * List memories with pagination. For memory dashboard.
 */
export async function listMemories(options?: {
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}) {
  const sm = getClient();
  return sm.memories.list({
    containerTags: [CONTAINER_TAG],
    page: options?.page ?? 1,
    limit: options?.limit ?? 20,
    order: options?.order ?? 'desc',
    sort: 'createdAt',
  });
}

/**
 * Get user profile facts. For memory dashboard overview.
 */
export async function getProfile() {
  const sm = getClient();
  return sm.profile({
    containerTag: CONTAINER_TAG,
    q: '*',
  });
}
```

**Step 2: Create API route**

Create `src/app/api/memory/supermemory/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listMemories, getProfile } from '@/lib/memory/supermemory';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'overview';

  try {
    if (view === 'overview') {
      // Fetch stats (page 1 with limit 1 to get totalItems) + profile in parallel
      const [memoriesPage, profile] = await Promise.all([
        listMemories({ page: 1, limit: 1 }),
        getProfile(),
      ]);

      return NextResponse.json({
        stats: {
          totalMemories: memoriesPage.pagination.totalItems,
          totalPages: memoriesPage.pagination.totalPages,
        },
        profile: profile.profile,
      });
    }

    if (view === 'memories') {
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '20');
      const result = await listMemories({ page, limit });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
  } catch (error) {
    console.error('Supermemory API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Supermemory' },
      { status: 500 }
    );
  }
}
```

**Step 3: Commit**

```bash
git add src/lib/memory/supermemory.ts src/app/api/memory/supermemory/route.ts
git commit -m "feat: add supermemory dashboard API route"
```

---

### Task 2: Rewrite memory page with three tabs

**Files:**
- Rewrite: `src/app/memory/memory-client.tsx`
- Modify: `src/app/memory/page.tsx` (simplify — no more server-side data fetching)

**Step 1: Simplify page.tsx**

The server component no longer needs to call `getAllMemory()`. Just render the client:

```typescript
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MemoryClient } from "./memory-client";

export default async function MemoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <MemoryClient />;
}
```

**Step 2: Rewrite memory-client.tsx**

Three tabs: **Overview**, **Memories**, **Debug Feed**.

**Overview tab** shows:
- Stats card: total memories count
- Profile card: static facts (what supermemory knows about the user) and dynamic/recent facts
- Both fetched from `/api/memory/supermemory?view=overview`

**Memories tab** shows:
- Paginated list of memories from `/api/memory/supermemory?view=memories&page=N`
- Each memory card shows: title, type badge, status badge, summary snippet, created date
- Pagination controls at bottom
- Search bar that uses existing `/api/memory/search?q=` endpoint

**Debug Feed tab**: keep the existing `MemoryFeed` component exactly as-is.

Full implementation in the rewrite — see code in task execution.

**Step 3: Commit**

```bash
git add src/app/memory/page.tsx src/app/memory/memory-client.tsx
git commit -m "feat: rewrite memory page as supermemory dashboard"
```

---

### Task 3: Delete dead code

**Files:**
- Delete: `src/components/aurelius/memory-browser.tsx` (old entity browser)
- Delete: `src/app/api/memory/route.ts` (old PARA filesystem counts)
- Delete: `src/app/api/memory/browse/[...path]/route.ts` (old filesystem browser)
- Delete: `src/app/api/memory/[factId]/route.ts` (old fact deletion — uses local DB)
- Modify: `src/lib/memory/search.ts` (remove `getAllMemory` function)

**Step 1: Delete files**

```bash
rm src/components/aurelius/memory-browser.tsx
rm src/app/api/memory/route.ts
rm -r src/app/api/memory/browse/
rm -r src/app/api/memory/\[factId\]/
```

**Step 2: Remove `getAllMemory` from search.ts**

Remove the `getAllMemory` function and the unused `searchMemories` import at top (if it's only used there). Keep `buildMemoryContext` — that's used by chat.

**Step 3: Verify no remaining imports**

```bash
grep -r "getAllMemory\|memory-browser\|MemoryBrowser" src/
```

Should return nothing.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old memory entity browser and PARA file routes"
```

---

### Task 4: Smoke test

**Step 1: Run dev server and verify**

- Navigate to `/memory`
- Overview tab loads stats + profile
- Memories tab loads paginated list
- Debug Feed tab still works
- No console errors

**Step 2: Run type check**

```bash
bun run build
```

Fix any type errors.

**Step 3: Commit any fixes**

---

## Files to Delete (summary)
- `src/components/aurelius/memory-browser.tsx`
- `src/app/api/memory/route.ts`
- `src/app/api/memory/browse/[...path]/route.ts`
- `src/app/api/memory/[factId]/route.ts`

## Files to Keep
- `src/app/api/memory/events/route.ts` (debug feed)
- `src/app/api/memory/events/stream/route.ts` (SSE for debug feed)
- `src/app/api/memory/search/route.ts` (used by memories tab search)
- `src/lib/memory/events.ts` (event system)
- `src/lib/memory/supermemory.ts` (core SDK wrapper)
- `src/lib/memory/search.ts` (keep `buildMemoryContext`, remove `getAllMemory`)
