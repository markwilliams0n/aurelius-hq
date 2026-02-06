# Memory Debug Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a memory event system that instruments all memory operations (recall, extract, save) with full payloads + reasoning, a CMD+M debug overlay, and a debug evaluator mode.

**Architecture:** New `memory_events` DB table + in-memory buffer. `emitMemoryEvent()` utility called from existing memory functions. `MemoryDebugProvider` (same pattern as `ChatProvider`) handles CMD+M shortcut and overlay rendering. SSE endpoint for live event streaming. Debug evaluator gated by a header flag.

**Tech Stack:** Drizzle ORM (PostgreSQL), React Context + hooks, SSE (ReadableStream), Ollama (local LLM for evaluator), shadcn/Tailwind UI components.

**Design doc:** `docs/plans/2026-02-05-memory-debug-mode-design.md`

---

## Task 1: Memory Events DB Schema

**Files:**
- Create: `src/lib/db/schema/memory-events.ts`
- Modify: `src/lib/db/schema/index.ts`

**Step 1: Write the schema file**

Create `src/lib/db/schema/memory-events.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const memoryEventTypeEnum = pgEnum("memory_event_type", [
  "recall",
  "extract",
  "save",
  "search",
  "reindex",
  "evaluate",
]);

export const memoryEventTriggerEnum = pgEnum("memory_event_trigger", [
  "chat",
  "heartbeat",
  "triage",
  "manual",
  "api",
]);

export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    eventType: memoryEventTypeEnum("event_type").notNull(),
    trigger: memoryEventTriggerEnum("trigger").notNull(),
    triggerId: text("trigger_id"),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    reasoning: jsonb("reasoning").$type<Record<string, unknown>>(),
    evaluation: jsonb("evaluation").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("memory_events_timestamp_idx").on(table.timestamp),
    index("memory_events_event_type_idx").on(table.eventType),
    index("memory_events_trigger_idx").on(table.trigger),
  ]
);

export type MemoryEvent = typeof memoryEvents.$inferSelect;
export type NewMemoryEvent = typeof memoryEvents.$inferInsert;
```

**Step 2: Add export to schema index**

In `src/lib/db/schema/index.ts`, add:

```typescript
export * from "./memory-events";
```

**Step 3: Generate and run migration**

Run: `npx drizzle-kit generate`
Then: `npx drizzle-kit push`

Expected: Migration file created in `./drizzle/`, table created in DB.

**Step 4: Commit**

```bash
git add src/lib/db/schema/memory-events.ts src/lib/db/schema/index.ts drizzle/
git commit -m "feat: add memory_events DB schema"
```

---

## Task 2: Memory Event Emitter (Core Utility)

**Files:**
- Create: `src/lib/memory/events.ts`

**Step 1: Write the event emitter**

Create `src/lib/memory/events.ts`:

```typescript
import { db } from "@/lib/db";
import { memoryEvents, type NewMemoryEvent, type MemoryEvent } from "@/lib/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";

// --- Types ---

export type MemoryEventType = "recall" | "extract" | "save" | "search" | "reindex" | "evaluate";
export type MemoryEventTrigger = "chat" | "heartbeat" | "triage" | "manual" | "api";

export interface EmitMemoryEventParams {
  eventType: MemoryEventType;
  trigger: MemoryEventTrigger;
  triggerId?: string;
  summary: string;
  payload?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

// --- In-Memory Buffer ---

const BUFFER_MAX = 100;
const eventBuffer: MemoryEvent[] = [];
const listeners: Set<(event: MemoryEvent) => void> = new Set();

export function getRecentEvents(limit = 20): MemoryEvent[] {
  return eventBuffer.slice(0, limit);
}

export function onMemoryEvent(listener: (event: MemoryEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Emit ---

export async function emitMemoryEvent(params: EmitMemoryEventParams): Promise<MemoryEvent | null> {
  // Build the row
  const row: NewMemoryEvent = {
    eventType: params.eventType,
    trigger: params.trigger,
    triggerId: params.triggerId ?? null,
    summary: params.summary,
    payload: params.payload ?? null,
    reasoning: params.reasoning ?? null,
    evaluation: params.evaluation ?? null,
    durationMs: params.durationMs ?? null,
    metadata: params.metadata ?? null,
  };

  // Push to in-memory buffer first (fast path)
  const bufferEntry: MemoryEvent = {
    ...row,
    id: crypto.randomUUID(),
    timestamp: new Date(),
  } as MemoryEvent;

  eventBuffer.unshift(bufferEntry);
  if (eventBuffer.length > BUFFER_MAX) {
    eventBuffer.pop();
  }

  // Notify listeners (SSE connections)
  for (const listener of listeners) {
    try {
      listener(bufferEntry);
    } catch {
      // Don't let listener errors break emit
    }
  }

  // Async DB write (fire-and-forget)
  try {
    const [inserted] = await db.insert(memoryEvents).values(row).returning();
    // Update buffer entry with real ID
    bufferEntry.id = inserted.id;
    return inserted;
  } catch (error) {
    console.error("[MemoryEvents] DB write failed:", error);
    return bufferEntry;
  }
}

// --- Query ---

export async function getMemoryEvents(options: {
  limit?: number;
  eventType?: MemoryEventType;
  trigger?: MemoryEventTrigger;
  since?: Date;
} = {}): Promise<MemoryEvent[]> {
  const { limit = 50, eventType, trigger, since } = options;

  const conditions = [];
  if (eventType) conditions.push(eq(memoryEvents.eventType, eventType));
  if (trigger) conditions.push(eq(memoryEvents.trigger, trigger));
  if (since) conditions.push(gte(memoryEvents.timestamp, since));

  return db
    .select()
    .from(memoryEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memoryEvents.timestamp))
    .limit(limit);
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

Expected: No errors in `events.ts`.

**Step 3: Commit**

```bash
git add src/lib/memory/events.ts
git commit -m "feat: add memory event emitter with in-memory buffer"
```

---

## Task 3: Memory Events API Routes

**Files:**
- Create: `src/app/api/memory/events/route.ts`
- Create: `src/app/api/memory/events/stream/route.ts`

**Step 1: Write the REST endpoint**

Create `src/app/api/memory/events/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getMemoryEvents } from "@/lib/memory/events";

/**
 * GET /api/memory/events
 *
 * Query memory events from DB.
 * Params: limit, eventType, trigger, since (ISO string)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const eventType = searchParams.get("eventType") as any;
  const trigger = searchParams.get("trigger") as any;
  const sinceStr = searchParams.get("since");
  const since = sinceStr ? new Date(sinceStr) : undefined;

  const events = await getMemoryEvents({ limit, eventType, trigger, since });

  return NextResponse.json({ events });
}
```

**Step 2: Write the SSE stream endpoint**

Create `src/app/api/memory/events/stream/route.ts`:

```typescript
import { onMemoryEvent, getRecentEvents } from "@/lib/memory/events";

export const runtime = "nodejs";

/**
 * GET /api/memory/events/stream
 *
 * SSE stream of memory events.
 * Sends recent events on connect, then streams new ones.
 */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Send recent events on connect
      const recent = getRecentEvents(20);
      send({ type: "init", events: recent });

      // Stream new events
      const unsubscribe = onMemoryEvent((event) => {
        send({ type: "event", event });
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on close
      request_cleanup(() => {
        unsubscribe();
        clearInterval(heartbeat);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Helper: Next.js doesn't give us a clean close signal for SSE,
// so we use AbortController pattern. The ReadableStream cancel()
// handles cleanup when client disconnects.
function request_cleanup(fn: () => void) {
  // The cleanup runs when the ReadableStream is cancelled (client disconnect).
  // We store the fn and call it in the stream's cancel callback.
  // NOTE: This is a simplified pattern - the actual cleanup hook
  // should be wired into the ReadableStream's cancel() method.
  // Adjust during implementation to match the heartbeat/stream pattern.
}
```

Note: The SSE cleanup pattern should be refined during implementation to match how `src/app/api/heartbeat/stream/route.ts` handles stream lifecycle. The key pattern: `new ReadableStream({ start(controller) { ... }, cancel() { cleanup() } })`.

**Step 3: Commit**

```bash
git add src/app/api/memory/events/
git commit -m "feat: add memory events REST + SSE API routes"
```

---

## Task 4: Instrument buildAgentContext (Chat Recall)

**Files:**
- Modify: `src/lib/ai/context.ts`

This is the highest-value instrumentation point — it shows what memory the agent sees when responding to a chat message.

**Step 1: Add instrumentation to buildAgentContext**

In `src/lib/ai/context.ts`, add import and wrap the parallel calls with timing + event emission:

```typescript
// Add at top:
import { emitMemoryEvent } from '@/lib/memory/events';

// In buildAgentContext, wrap the existing Promise.all with timing:
export async function buildAgentContext(
  options: AgentContextOptions
): Promise<AgentContext> {
  const { query, modelId = DEFAULT_MODEL, additionalContext } = options;
  const startTime = Date.now();

  // Gather all context pieces in parallel
  const [recentNotes, memoryContext, soulConfigResult] = await Promise.all([
    getRecentNotes(),
    buildMemoryContext(query, { collection: 'life' }),
    getConfig('soul'),
  ]);

  const soulConfig = soulConfigResult?.content || null;
  const durationMs = Date.now() - startTime;

  // Build the system prompt
  let systemPrompt = buildChatPrompt({
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  });

  if (additionalContext) {
    systemPrompt += `\n\n${additionalContext}`;
  }

  // Emit recall event
  emitMemoryEvent({
    eventType: 'recall',
    trigger: 'chat',
    summary: `Recalled memory for: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`,
    payload: {
      query,
      recentNotes: recentNotes ? recentNotes.slice(0, 2000) : null,
      memoryContext,
      hasRecentNotes: !!recentNotes,
      hasMemoryContext: !!memoryContext,
      systemPromptLength: systemPrompt.length,
    },
    durationMs,
    metadata: { modelId, collection: 'life' },
  }).catch(() => {}); // fire-and-forget

  return {
    systemPrompt,
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

**Step 3: Commit**

```bash
git add src/lib/ai/context.ts
git commit -m "feat: instrument buildAgentContext with memory event"
```

---

## Task 5: Instrument extractEmailMemory (Triage Save)

**Files:**
- Modify: `src/lib/memory/ollama.ts`

**Step 1: Add event emission to extractEmailMemory**

In `src/lib/memory/ollama.ts`, add import at top:

```typescript
import { emitMemoryEvent } from './events';
```

Then wrap the `extractEmailMemory` function body with timing and emit an event after extraction completes. The event should capture:
- Input: subject, sender, content length
- Output: entities found, facts extracted, action items, summary
- The raw Ollama response (for debugging prompt quality)
- What was filtered out (empty entities, empty facts)

Add after the `return` statement at line 464 (before the catch):

```typescript
    // After parsing, before return — emit extract event
    const result = {
      entities: (parsed.entities || []).filter(e => e.name && e.type),
      facts: (parsed.facts || []).filter(f => f.content),
      actionItems: parsed.actionItems || [],
      summary: parsed.summary || `Email from ${senderName || sender}: ${subject}`,
    };

    emitMemoryEvent({
      eventType: 'extract',
      trigger: 'triage',
      summary: `Extracted ${result.entities.length} entities, ${result.facts.length} facts from "${subject.slice(0, 60)}"`,
      payload: {
        input: { subject, sender, senderName, contentLength: content.length },
        output: result,
        rawOllamaResponse: response,
        filteredEntities: (parsed.entities || []).filter(e => !e.name || !e.type),
        filteredFacts: (parsed.facts || []).filter(f => !f.content),
      },
      durationMs: Date.now() - startTime,
      metadata: { model: DEFAULT_MODEL, connector: 'email' },
    }).catch(() => {});

    return result;
```

Add `const startTime = Date.now();` at the start of the function body (after line 372).

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

**Step 3: Commit**

```bash
git add src/lib/memory/ollama.ts
git commit -m "feat: instrument extractEmailMemory with memory event"
```

---

## Task 6: Instrument Heartbeat Entity Extraction

**Files:**
- Modify: `src/lib/memory/heartbeat.ts`

**Step 1: Add event emissions to heartbeat**

In `src/lib/memory/heartbeat.ts`, add import:

```typescript
import { emitMemoryEvent } from './events';
```

Add events at these points in `runHeartbeat()`:

1. **After entity extraction** (around line 650, after `resolveEntities()`):
   - Event type: `extract`, trigger: `heartbeat`
   - Payload: extracted entities, resolved matches, new vs existing, extraction method (ollama vs pattern)

2. **After entity creation/update loop** (around line 735):
   - Event type: `save`, trigger: `heartbeat`
   - Payload: entities created, entities updated, facts added, facts deduplicated

3. **After QMD reindex** (around line 950):
   - Event type: `reindex`, trigger: `heartbeat`
   - Payload: duration, success/failure

The exact line numbers will shift — the implementer should find:
- The block after `resolveEntities()` is called (extraction complete)
- The block after the create/update entity loop finishes
- The blocks after `qmd update` and `qmd embed` commands

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

**Step 3: Commit**

```bash
git add src/lib/memory/heartbeat.ts
git commit -m "feat: instrument heartbeat with memory events"
```

---

## Task 7: Instrument Post-Chat Extraction + Daily Note Writes

**Files:**
- Modify: `src/lib/memory/extraction.ts`
- Modify: `src/lib/memory/daily-notes.ts`

**Step 1: Instrument extractAndSaveMemories**

In `src/lib/memory/extraction.ts`, add import and wrap:

```typescript
import { emitMemoryEvent } from './events';
```

Emit events for:
- What was extracted (semantic note or fallback format)
- Whether Ollama was used or fallback
- The input conversation snippet

**Step 2: Instrument appendToDailyNote**

In `src/lib/memory/daily-notes.ts`, add import and emit a `save` event:

```typescript
import { emitMemoryEvent } from './events';
```

After the file write (line 70 or 80), emit:
- Event type: `save`, trigger inferred from caller (use metadata)
- Payload: content written, file path, whether file was created or appended

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

**Step 4: Commit**

```bash
git add src/lib/memory/extraction.ts src/lib/memory/daily-notes.ts
git commit -m "feat: instrument chat extraction and daily note writes"
```

---

## Task 8: Instrument Memory Search

**Files:**
- Modify: `src/lib/memory/search.ts`

**Step 1: Add event emission to buildMemoryContext**

In `src/lib/memory/search.ts`, add import:

```typescript
import { emitMemoryEvent } from './events';
```

After `searchMemory()` returns results (line 183), emit a `search` event with:
- Query, collection, limit
- Full search results with scores
- Which results made it into the formatted context
- Duration

Also instrument `searchMemory()`, `keywordSearch()`, and `semanticSearch()` individually so explicit API searches are tracked too.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`

**Step 3: Commit**

```bash
git add src/lib/memory/search.ts
git commit -m "feat: instrument memory search with events"
```

---

## Task 9: MemoryDebugProvider (CMD+M Shortcut)

**Files:**
- Create: `src/components/aurelius/memory-debug-provider.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Create the provider**

Model after `src/components/aurelius/chat-provider.tsx`. Create `src/components/aurelius/memory-debug-provider.tsx`:

```typescript
"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MemoryDebugPanel } from "./memory-debug-panel";

type MemoryDebugContextType = {
  isOpen: boolean;
  debugMode: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setDebugMode: (on: boolean) => void;
};

const MemoryDebugContext = createContext<MemoryDebugContextType | null>(null);

export function useMemoryDebug() {
  const context = useContext(MemoryDebugContext);
  if (!context) {
    throw new Error("useMemoryDebug must be used within MemoryDebugProvider");
  }
  return context;
}

export function MemoryDebugProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Cmd+M shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "m") {
        e.preventDefault();
        toggle();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <MemoryDebugContext.Provider
      value={{ isOpen, debugMode, open, close, toggle, setDebugMode }}
    >
      {children}
      <MemoryDebugPanel isOpen={isOpen} onClose={close} />
    </MemoryDebugContext.Provider>
  );
}
```

**Step 2: Add to layout**

In `src/app/layout.tsx`, wrap children with `MemoryDebugProvider` (inside `ChatProvider`):

```typescript
import { MemoryDebugProvider } from "@/components/aurelius/memory-debug-provider";

// In the JSX:
<ChatProvider>
  <MemoryDebugProvider>
    {children}
  </MemoryDebugProvider>
</ChatProvider>
```

**Step 3: Create stub panel**

Create a minimal `MemoryDebugPanel` stub so the provider compiles — we'll flesh it out in the next task.

**Step 4: Verify it compiles and shortcut works**

Run: `bun run dev` and test CMD+M opens/closes the stub panel.

**Step 5: Commit**

```bash
git add src/components/aurelius/memory-debug-provider.tsx src/app/layout.tsx
git commit -m "feat: add MemoryDebugProvider with CMD+M shortcut"
```

---

## Task 10: Memory Debug Panel (Overlay UI)

**Files:**
- Create: `src/components/aurelius/memory-debug-panel.tsx`

**Step 1: Build the panel component**

This is a slide-out panel from the right. Use the pattern from `right-sidebar.tsx` but rendered as a fixed overlay (like the chat panel).

The panel should:
1. Connect to SSE endpoint `/api/memory/events/stream` on mount
2. Show events in a chronological list (newest first)
3. Each event is a clickable card that expands to show full payload
4. Debug mode toggle in the header
5. "View all" link to `/memory` page

Event card compact view:
```
[icon] HH:MM  Event type summary
       trigger: brief description
```

Event card expanded view:
- Full payload rendered as formatted key-value pairs
- Reasoning section (if present)
- Evaluation section (if debug mode was on)
- Duration badge

Use existing UI patterns:
- `lucide-react` icons: `Search` for recall, `PenLine` for extract, `Save` for save, `RefreshCw` for reindex
- Gold accent color for active states
- `text-muted-foreground` for secondary text
- `border-border bg-card rounded-lg` for cards

**Step 2: Wire up SSE connection**

Use the same SSE consumption pattern from `src/app/system/page.tsx` (lines 217-280):
- `fetch()` the stream endpoint
- Read with `response.body.getReader()`
- Decode with `TextDecoder`
- Buffer by `\n\n`
- Parse `data: ` lines

**Step 3: Test the overlay**

Run: `bun run dev`, send a chat message, hit CMD+M, verify the recall event appears.

**Step 4: Commit**

```bash
git add src/components/aurelius/memory-debug-panel.tsx
git commit -m "feat: add memory debug overlay panel with SSE"
```

---

## Task 11: Debug Mode Indicator in Sidebar

**Files:**
- Modify: `src/components/aurelius/app-sidebar.tsx`

**Step 1: Add debug indicator**

When debug mode is on, show a small indicator on the Memory nav item (or near the logo). Use the `useMemoryDebug()` hook:

```typescript
import { useMemoryDebug } from "./memory-debug-provider";

// Inside AppSidebar:
const { debugMode } = useMemoryDebug();
```

For the Memory nav item, add a small dot when debug mode is on:

```typescript
// After the icon in the Memory nav item:
{debugMode && (
  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gold animate-pulse" />
)}
```

Make the nav item container `relative` to position the dot.

**Step 2: Test**

Toggle debug mode in the CMD+M panel, verify the dot appears/disappears on the Memory nav item.

**Step 3: Commit**

```bash
git add src/components/aurelius/app-sidebar.tsx
git commit -m "feat: add debug mode indicator to sidebar"
```

---

## Task 12: Modify Ollama Extraction Prompts for Reasoning

**Files:**
- Modify: `src/lib/memory/ollama.ts`

**Step 1: Update extractEmailMemory prompt**

In the `extractEmailMemory` function, modify the JSON output format in the prompt to include reasoning:

```json
{
  "entities": [{"name": "...", "type": "...", "facts": ["..."], "reasoning": "why this entity was extracted"}],
  "facts": [{"content": "...", "category": "...", "entityName": "...", "reasoning": "why this fact matters"}],
  "actionItems": [{"description": "...", "dueDate": "..."}],
  "skipped": [{"item": "...", "reasoning": "why this was skipped"}],
  "summary": "..."
}
```

Update the `EmailMemoryExtraction` interface to include reasoning fields. Store the reasoning in the memory event's `reasoning` field.

**Step 2: Update extractEntitiesWithLLM prompt**

Similarly, add reasoning to the entity extraction prompt used by heartbeat. Include `reasoning` per entity and a `skipped` array.

**Step 3: Verify both functions still produce valid output**

Run a manual test: trigger a triage save-to-memory and check the memory event payload includes reasoning.

**Step 4: Commit**

```bash
git add src/lib/memory/ollama.ts
git commit -m "feat: add reasoning to Ollama extraction prompts"
```

---

## Task 13: Debug Evaluator

**Files:**
- Create: `src/lib/memory/evaluator.ts`
- Modify: `src/lib/memory/ollama.ts` (or `events.ts`)

**Step 1: Write the evaluator**

Create `src/lib/memory/evaluator.ts`:

```typescript
import { generate, isOllamaAvailable } from './ollama';
import { emitMemoryEvent } from './events';

export interface EvaluationResult {
  score: number; // 1-5
  missed: string[];
  weak: string[];
  good: string[];
  suggestions: string[];
}

/**
 * Evaluate the quality of a memory extraction.
 * Runs a second Ollama call that critiques the extraction.
 * Only called when debug mode is on.
 */
export async function evaluateExtraction(params: {
  input: string;
  extracted: {
    entities: Array<{ name: string; type: string; facts: string[] }>;
    facts: Array<{ content: string; category: string }>;
    summary: string;
  };
  context: string; // e.g. "email from John Smith about Q3 planning"
}): Promise<EvaluationResult | null> {
  if (!(await isOllamaAvailable())) return null;

  const startTime = Date.now();

  const prompt = `You are a memory quality evaluator. Review how well information was extracted from content.

ORIGINAL CONTENT:
${params.input.slice(0, 4000)}

EXTRACTED:
Entities: ${JSON.stringify(params.extracted.entities)}
Facts: ${JSON.stringify(params.extracted.facts)}
Summary: ${params.extracted.summary}

Evaluate the extraction quality:

1. Score (1-5): How well were key facts captured?
2. Missed: Important information NOT captured (be specific)
3. Weak: Extracted items that are too vague or useless
4. Good: Well-extracted items that are specific and useful
5. Suggestions: How to improve extraction

Output ONLY valid JSON:
{
  "score": 4,
  "missed": ["specific thing that was missed"],
  "weak": ["extracted item that is too vague"],
  "good": ["well-extracted item"],
  "suggestions": ["improvement suggestion"]
}

JSON only:`;

  try {
    const response = await generate(prompt, { temperature: 0.2, maxTokens: 1000 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as EvaluationResult;
    const durationMs = Date.now() - startTime;

    // Emit evaluation event
    emitMemoryEvent({
      eventType: 'evaluate',
      trigger: 'manual',
      summary: `Evaluation score: ${parsed.score}/5 for: ${params.context.slice(0, 60)}`,
      payload: { input: params.context, evaluation: parsed },
      durationMs,
      metadata: { score: parsed.score },
    }).catch(() => {});

    return parsed;
  } catch (error) {
    console.error('[Evaluator] Failed:', error);
    return null;
  }
}
```

**Step 2: Wire evaluator into extraction functions**

In the triage save-to-memory flow (`src/app/api/triage/[id]/memory/route.ts`), after extraction completes, check for the `X-Debug-Memory` header. If present, run the evaluator and attach results to the event.

Alternatively, wire into `emitMemoryEvent` for `extract` events — if debug mode is on (check a global flag or header), run evaluator and update the event's `evaluation` field.

**Step 3: Commit**

```bash
git add src/lib/memory/evaluator.ts
git commit -m "feat: add debug evaluator for memory extraction quality"
```

---

## Task 14: Update Memory Page with Debug Feed Tab

**Files:**
- Modify: `src/app/memory/memory-client.tsx`

**Step 1: Add a tab bar to the Memory page**

Add tabs: "Entities" (existing content) and "Debug Feed" (new). The Debug Feed tab shows the same event stream as the overlay but queries from the DB with filters.

Use the existing MemoryBrowser as the Entities tab content. Create a new MemoryFeed component for the Debug Feed tab that:
- Fetches from `/api/memory/events?limit=100`
- Groups events by day
- Filterable by eventType and trigger
- Same expandable card pattern as the overlay
- Searchable (client-side filter on summary text)

**Step 2: Commit**

```bash
git add src/app/memory/memory-client.tsx
git commit -m "feat: add debug feed tab to Memory page"
```

---

## Task 15: Integration Test — End-to-End Flow

**Step 1: Manual smoke test**

1. Start dev server: `bun run dev`
2. Open the app, navigate to Triage
3. Hit CMD+M — overlay should appear (empty or with any existing events)
4. Save a triage item to memory (ArrowUp)
5. Watch the overlay — should see `extract` and `save` events appear
6. Click an event to expand — verify payload shows extracted entities/facts/reasoning
7. Go to Chat, send a message
8. Check overlay — should see `recall` event with search results and prompt context
9. Toggle debug mode ON
10. Save another triage item — verify `evaluate` event appears with quality score
11. Check the debug indicator in the sidebar — small dot should be visible
12. Navigate to Memory page — Debug Feed tab should show all events with filters

**Step 2: Fix any issues found**

**Step 3: Commit any fixes**

```bash
git commit -m "fix: memory debug integration fixes"
```
