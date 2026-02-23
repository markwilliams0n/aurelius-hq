# Reading List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reading list page that collects X bookmarks via browser scraping, AI-summarizes them, and displays them as a card-based reference list.

**Architecture:** New `reading_list` DB table (source-agnostic), API routes for CRUD + sync trigger, browser automation to scrape x.com/i/bookmarks, OpenRouter summarization at ingest, and a new `/reading-list` page in the app shell.

**Tech Stack:** Drizzle ORM, Next.js App Router, Claude in Chrome MCP tools, OpenRouter (kimi-k2.5), Tailwind CSS v4

---

### Task 1: Database Schema

**Files:**
- Create: `src/lib/db/schema/reading-list.ts`
- Modify: `src/lib/db/schema/index.ts`

**Step 1: Create the schema file**

```typescript
// src/lib/db/schema/reading-list.ts
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const readingItemSourceEnum = pgEnum("reading_item_source", [
  "x-bookmark",
  "manual",
]);

export const readingItemStatusEnum = pgEnum("reading_item_status", [
  "unread",
  "read",
  "archived",
]);

export const readingList = pgTable(
  "reading_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: readingItemSourceEnum("source").notNull(),
    sourceId: text("source_id"),
    url: text("url"),
    title: text("title"),
    content: text("content"),
    summary: text("summary"),
    tags: text("tags").array().default([]),
    rawPayload: jsonb("raw_payload"),
    status: readingItemStatusEnum("status").default("unread").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("reading_list_status_idx").on(table.status),
    index("reading_list_source_idx").on(table.source),
    index("reading_list_source_id_idx").on(table.sourceId),
  ]
);

export type ReadingListItem = typeof readingList.$inferSelect;
export type NewReadingListItem = typeof readingList.$inferInsert;
```

**Step 2: Register in schema index**

Add to `src/lib/db/schema/index.ts`:
```typescript
export * from "./reading-list";
```

**Step 3: Generate and push migration**

Run: `npx drizzle-kit generate`
Run: `npx drizzle-kit push`

**Step 4: Verify**

Run: `npx drizzle-kit push` — should report no changes needed (already up to date).

**Step 5: Commit**

```
feat: add reading_list database schema
```

---

### Task 2: API Routes — List + Update

**Files:**
- Create: `src/app/api/reading-list/route.ts`
- Create: `src/app/api/reading-list/[id]/route.ts`

**Step 1: Create GET route**

```typescript
// src/app/api/reading-list/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tag = url.searchParams.get("tag");

  try {
    const conditions = [];

    if (status) {
      conditions.push(eq(readingList.status, status as any));
    } else {
      // Default: show unread + read (not archived)
      conditions.push(
        inArray(readingList.status, ["unread", "read"])
      );
    }

    const items = await db
      .select()
      .from(readingList)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(readingList.createdAt));

    // Filter by tag in JS (text[] not great for SQL filtering)
    const filtered = tag
      ? items.filter((item) => item.tags?.includes(tag))
      : items;

    return NextResponse.json({ items: filtered });
  } catch (error) {
    console.error("[Reading List API] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading list" },
      { status: 500 }
    );
  }
}
```

**Step 2: Create PATCH route for status updates**

```typescript
// src/app/api/reading-list/[id]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { status } = body;

    if (!["unread", "read", "archived"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const result = await db
      .update(readingList)
      .set({ status })
      .where(eq(readingList.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("[Reading List API] PATCH failed:", error);
    return NextResponse.json(
      { error: "Failed to update reading list item" },
      { status: 500 }
    );
  }
}
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```
feat: add reading list API routes (GET + PATCH)
```

---

### Task 3: Summarization Module

**Files:**
- Create: `src/lib/reading-list/summarize.ts`

**Step 1: Create the summarization function**

```typescript
// src/lib/reading-list/summarize.ts
import { chat } from "@/lib/ai/client";

interface SummarizeResult {
  summary: string;
  tags: string[];
}

const VALID_TAGS = [
  "tech", "business", "design", "AI", "finance",
  "culture", "health", "science", "other",
];

export async function summarizeBookmark(content: string, author: string): Promise<SummarizeResult> {
  const prompt = `Summarize this tweet/thread by @${author} in 1-2 sentences. Then assign 1-3 topic tags from this list: ${VALID_TAGS.join(", ")}.

Tweet content:
${content}

Respond in this exact JSON format, no other text:
{"summary": "...", "tags": ["...", "..."]}`;

  const result = await chat(prompt, "You are a concise summarizer. Respond only with valid JSON.", { maxTokens: 256 });

  try {
    const parsed = JSON.parse(result.trim());
    return {
      summary: parsed.summary || content.slice(0, 200),
      tags: (parsed.tags || []).filter((t: string) => VALID_TAGS.includes(t)),
    };
  } catch {
    // Fallback if JSON parsing fails
    return {
      summary: content.slice(0, 200),
      tags: ["other"],
    };
  }
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat: add reading list bookmark summarization
```

---

### Task 4: X Bookmarks Scraper

**Files:**
- Create: `src/lib/reading-list/x-bookmarks.ts`

This is the most complex part. It uses the Claude in Chrome MCP tools to scrape bookmarks from x.com. Since MCP tools are called from the server, this will be triggered by the sync API route and executed via a function that calls the browser tools.

**Step 1: Create the scraper module**

```typescript
// src/lib/reading-list/x-bookmarks.ts
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { summarizeBookmark } from "./summarize";

export interface ScrapedBookmark {
  tweetId: string;
  author: string;
  content: string;
  url: string;
  timestamp?: string;
}

/**
 * Store scraped bookmarks: dedupe, summarize, insert.
 * The actual browser scraping is done by the caller (sync route)
 * since MCP browser tools are only available in the Claude session.
 * This function handles the DB + summarization pipeline.
 */
export async function processScrapedBookmarks(
  bookmarks: ScrapedBookmark[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const bookmark of bookmarks) {
    // Check for existing by sourceId
    const existing = await db
      .select({ id: readingList.id })
      .from(readingList)
      .where(eq(readingList.sourceId, bookmark.tweetId))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Summarize
    const { summary, tags } = await summarizeBookmark(
      bookmark.content,
      bookmark.author
    );

    // Insert
    await db.insert(readingList).values({
      source: "x-bookmark",
      sourceId: bookmark.tweetId,
      url: bookmark.url,
      title: `@${bookmark.author}`,
      content: bookmark.content,
      summary,
      tags,
      rawPayload: bookmark,
    });

    added++;
  }

  return { added, skipped };
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat: add X bookmark processing pipeline (dedupe + summarize + store)
```

---

### Task 5: Sync API Route

**Files:**
- Modify: `src/app/api/reading-list/route.ts`

**Step 1: Add POST handler for sync trigger**

Add to the existing `route.ts`:

```typescript
import { processScrapedBookmarks, ScrapedBookmark } from "@/lib/reading-list/x-bookmarks";

// POST /api/reading-list — receive scraped bookmarks and process them
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bookmarks } = body as { bookmarks: ScrapedBookmark[] };

    if (!bookmarks || !Array.isArray(bookmarks)) {
      return NextResponse.json(
        { error: "bookmarks array required" },
        { status: 400 }
      );
    }

    const result = await processScrapedBookmarks(bookmarks);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[Reading List API] POST sync failed:", error);
    return NextResponse.json(
      { error: "Failed to process bookmarks" },
      { status: 500 }
    );
  }
}
```

**Note on the scraping flow:** The actual browser scraping happens in the Claude chat session (since MCP tools are available there). The flow is:
1. User clicks "Sync X" on the reading list page
2. Page sends a message to the chat asking Aurelius to scrape bookmarks
3. Aurelius uses Claude in Chrome tools to navigate x.com/i/bookmarks, extract data
4. Aurelius POSTs the extracted data to `/api/reading-list`
5. API dedupes, summarizes, stores

Alternative simpler flow (for v1): The sync button could trigger a chat message directly, and the AI handles the whole pipeline. We can decide during implementation.

**Step 2: Run type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat: add reading list sync endpoint
```

---

### Task 6: Frontend — Reading List Page

**Files:**
- Create: `src/app/reading-list/page.tsx`
- Create: `src/app/reading-list/reading-list-client.tsx`
- Modify: `src/components/aurelius/app-sidebar.tsx`

**Step 1: Create server page**

```typescript
// src/app/reading-list/page.tsx
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReadingListClient } from "./reading-list-client";

export default async function ReadingListPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <ReadingListClient />;
}
```

**Step 2: Create client component**

Build `reading-list-client.tsx` with:
- Fetch items from `/api/reading-list` on mount
- Tag filter bar (derived from tags in fetched items)
- Card list: each card shows source badge, title (@author), relative time, summary, tags
- "Open" button → opens URL in new tab, marks item as `read` via PATCH
- "Archive" button → PATCH status to `archived`
- "Sync X" button in header (placeholder for now — will wire to browser scraping)
- Use `AppShell` wrapper for layout

Style with Tailwind, match existing app aesthetic (dark theme compatible, `text-foreground`, `bg-secondary`, etc.).

**Step 3: Add sidebar nav entry**

In `src/components/aurelius/app-sidebar.tsx`:
- Import `BookOpen` from lucide-react
- Add `{ href: "/reading-list", icon: BookOpen, label: "Reading" }` to `navItems` array (after Tasks, before Vault)

**Step 4: Run type check + verify in browser**

Run: `npx tsc --noEmit`
Visit: `http://localhost:3333/reading-list` — should render empty state

**Step 5: Commit**

```
feat: add reading list page with card UI and sidebar nav
```

---

### Task 7: Wire Up Sync Button

**Files:**
- Modify: `src/app/reading-list/reading-list-client.tsx`

The "Sync X" button needs to trigger browser scraping. Since the Claude in Chrome MCP tools are only available in a Claude session (not from the Next.js server), the simplest v1 approach:

1. Sync button calls a dedicated API that returns instructions
2. OR — sync is done manually: user tells Aurelius in chat "sync my X bookmarks", Aurelius uses browser tools to scrape, then POSTs results to the API

For v1, implement the **manual chat approach**: the Sync button opens the chat panel (Cmd+K) with a pre-filled message like "Sync my X bookmarks to the reading list". This keeps it simple and leverages existing infrastructure.

**Step 1: Wire sync button to open chat panel with prefilled message**

The sync button should trigger the Cmd+K chat panel with a prefilled prompt. Check how `chat-panel.tsx` works and whether it accepts an initial message prop or event.

If the chat panel doesn't support prefilling, just show a toast/instruction: "Ask me in chat: 'sync my X bookmarks'"

**Step 2: Commit**

```
feat: wire reading list sync button to chat
```

---

### Task 8: Type Check + Manual Test

**Step 1: Full type check**

Run: `npx tsc --noEmit`

**Step 2: Test the full flow manually**

1. Visit `/reading-list` — empty state renders
2. Tag filters show nothing (no items yet)
3. Manually insert a test item via the API:

```bash
curl -X POST http://localhost:3333/api/reading-list \
  -H "Content-Type: application/json" \
  -d '{"bookmarks": [{"tweetId": "test-1", "author": "testuser", "content": "This is a test tweet about AI and startups", "url": "https://x.com/testuser/status/test-1"}]}'
```

4. Refresh `/reading-list` — card should appear with summary + tags
5. Click "Open" — opens URL, item dims (marked read)
6. Click "Archive" — item disappears from list
7. Filter by tag — works

**Step 3: Commit any fixes**

```
fix: reading list polish from manual testing
```
