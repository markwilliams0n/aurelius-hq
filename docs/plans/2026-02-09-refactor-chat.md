# Chat System Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Decompose the monolithic chat API route (277 lines) and useChat hook (402 lines) into focused, testable modules with better performance (context caching, O(1) tool dispatch) and cleaner architecture (shared SSE utilities, structured tool results, conversation history management).

**Architecture:** Extract shared SSE encode/decode utilities, add structured tool results to eliminate fragile JSON parsing, replace linear-scan tool dispatch with a Map, add TTL caching for slow-changing context, then split the route and hook into focused modules. Each phase is independently testable and commits separately.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, OpenRouter API (non-streaming tool calls + streaming fallback), Drizzle ORM + Neon PostgreSQL.

**Branch:** `feature/refactor-chat` (already created from main)

---

## Phase 1: Extract SSE Utilities

SSE encoding (`encoder.encode(\`data: ${JSON.stringify(...)}\n\n\`)`) is repeated in `src/app/api/chat/route.ts`, `src/app/api/heartbeat/stream/route.ts`, and `src/app/api/memory/events/stream/route.ts`. SSE parsing (client-side `line.startsWith("data: ")` / `.slice(6)`) is repeated in `src/hooks/use-chat.ts` and `src/components/aurelius/task-creator-panel.tsx`.

### Task 1.1: Create server-side SSE encoder utility

**Files:**
- Create: `src/lib/sse/server.ts`
- Test: `src/lib/sse/__tests__/server.test.ts`

**Step 1: Write the test**

```typescript
// src/lib/sse/__tests__/server.test.ts
import { describe, it, expect } from "vitest";
import { sseEncode, createSSEStream } from "../server";

describe("sseEncode", () => {
  it("encodes an object as an SSE data line", () => {
    const result = sseEncode({ type: "text", content: "hello" });
    const text = new TextDecoder().decode(result);
    expect(text).toBe('data: {"type":"text","content":"hello"}\n\n');
  });

  it("handles special characters in content", () => {
    const result = sseEncode({ type: "text", content: "line1\nline2" });
    const text = new TextDecoder().decode(result);
    const parsed = JSON.parse(text.replace("data: ", "").trim());
    expect(parsed.content).toBe("line1\nline2");
  });
});

describe("createSSEStream", () => {
  it("returns a ReadableStream and an emit function", () => {
    const { stream, emit, close } = createSSEStream();
    expect(stream).toBeInstanceOf(ReadableStream);
    expect(typeof emit).toBe("function");
    expect(typeof close).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/sse/__tests__/server.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement the server SSE utility**

```typescript
// src/lib/sse/server.ts
const encoder = new TextEncoder();

/** Encode a data object as a UTF-8 SSE `data:` frame */
export function sseEncode(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Create a ReadableStream wired to an emit/close pair.
 * Use `emit(data)` to push SSE frames and `close()` to end the stream.
 */
export function createSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    stream,
    emit(data: Record<string, unknown>) {
      controller.enqueue(sseEncode(data));
    },
    close() {
      controller.close();
    },
  };
}

/** Standard SSE response headers */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
```

**Step 4: Run test to verify it passes**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/sse/__tests__/server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sse/server.ts src/lib/sse/__tests__/server.test.ts
git commit -m "refactor: extract server-side SSE encoder utility"
```

### Task 1.2: Create client-side SSE parser utility

**Files:**
- Create: `src/lib/sse/client.ts`
- Test: `src/lib/sse/__tests__/client.test.ts`

**Step 1: Write the test**

```typescript
// src/lib/sse/__tests__/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseSSELines } from "../client";

describe("parseSSELines", () => {
  it("parses complete SSE data lines", () => {
    const events: unknown[] = [];
    const buffer = parseSSELines(
      'data: {"type":"text","content":"hello"}\n\ndata: {"type":"done"}\n\n',
      (data) => events.push(data),
    );
    expect(events).toEqual([
      { type: "text", content: "hello" },
      { type: "done" },
    ]);
    expect(buffer).toBe("");
  });

  it("returns incomplete line as buffer remainder", () => {
    const events: unknown[] = [];
    const buffer = parseSSELines(
      'data: {"type":"text","content":"hel',
      (data) => events.push(data),
    );
    expect(events).toEqual([]);
    expect(buffer).toBe('data: {"type":"text","content":"hel');
  });

  it("skips non-data lines", () => {
    const events: unknown[] = [];
    parseSSELines('event: ping\ndata: {"type":"text"}\n\n', (data) =>
      events.push(data),
    );
    expect(events).toEqual([{ type: "text" }]);
  });

  it("skips malformed JSON gracefully", () => {
    const events: unknown[] = [];
    parseSSELines("data: {invalid json}\n\n", (data) => events.push(data));
    expect(events).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/sse/__tests__/client.test.ts`
Expected: FAIL

**Step 3: Implement the client SSE parser**

```typescript
// src/lib/sse/client.ts

/**
 * Parse raw text containing SSE frames, calling `onEvent` for each
 * successfully parsed `data:` line. Returns any incomplete trailing text
 * so the caller can prepend it to the next chunk.
 */
export function parseSSELines(
  raw: string,
  onEvent: (data: Record<string, unknown>) => void,
): string {
  const lines = raw.split("\n");
  // Last element may be incomplete — hold it as buffer
  const remainder = lines.pop() || "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.slice(6));
      onEvent(data);
    } catch {
      // Skip malformed JSON
    }
  }

  return remainder;
}
```

**Step 4: Run test to verify it passes**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/sse/__tests__/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sse/client.ts src/lib/sse/__tests__/client.test.ts
git commit -m "refactor: extract client-side SSE parser utility"
```

### Task 1.3: Adopt SSE utilities in existing code

**Files:**
- Modify: `src/app/api/chat/route.ts` — replace inline `encoder.encode(...)` with `sseEncode()` and `SSE_HEADERS`
- Modify: `src/hooks/use-chat.ts` — replace inline SSE parsing with `parseSSELines()`
- Modify: `src/components/aurelius/task-creator-panel.tsx` — replace inline SSE parsing with `parseSSELines()`

**Step 1: Update `route.ts`**

Replace:
- All `encoder.encode(\`data: ${JSON.stringify(...)}\n\n\`)` calls with `sseEncode({...})`
- Remove `const encoder = new TextEncoder()` (line 77)
- Replace response headers object with `SSE_HEADERS` import
- Add import: `import { sseEncode, SSE_HEADERS } from "@/lib/sse/server";`

**Step 2: Update `use-chat.ts`**

In the `send` callback (~lines 274-301), replace the inline SSE parsing loop with `parseSSELines()`:

```typescript
import { parseSSELines } from "@/lib/sse/client";

// Inside the while(true) reader loop:
buffer += decoder.decode(value, { stream: true });
buffer = parseSSELines(buffer, processEvent);
```

Remove the entire `for (const line of lines)` block and the manual `lines.pop()` buffer handling.

**Step 3: Update `task-creator-panel.tsx`**

Same pattern — replace inline SSE parsing with `parseSSELines()` import and usage.

**Step 4: Run TypeScript check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No errors

**Step 5: Run existing tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add src/app/api/chat/route.ts src/hooks/use-chat.ts src/components/aurelius/task-creator-panel.tsx
git commit -m "refactor: adopt shared SSE utilities in chat route, hook, and task creator"
```

---

## Phase 2: Structured Tool Results

Currently, tool results are plain strings. The route detects action cards by `JSON.parse(event.result)` and checking for `.action_card` — fragile. Add an explicit `actionCard?` field to `ToolResult`.

### Task 2.1: Extend ToolResult type with optional actionCard field

**Files:**
- Modify: `src/lib/capabilities/types.ts` — add `actionCard?` to `ToolResult`
- Test: `src/lib/capabilities/__tests__/types.test.ts` (type-only check via tsc)

**Step 1: Update the ToolResult interface**

In `src/lib/capabilities/types.ts`, add an `actionCard` field to `ToolResult`:

```typescript
export interface ToolResult {
  result: string;
  pendingChangeId?: string;
  /** If the tool wants to show an action card in the UI, return it here */
  actionCard?: {
    pattern: string;
    title: string;
    data: Record<string, unknown>;
    handler?: string;
  };
}
```

**Step 2: Run TypeScript check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No errors (field is optional, so existing code is fine)

**Step 3: Commit**

```bash
git add src/lib/capabilities/types.ts
git commit -m "refactor: add optional actionCard field to ToolResult type"
```

### Task 2.2: Update capabilities to return structured actionCard

**Files:**
- Modify: any capability that returns `action_card` in its result string

Find which capabilities embed `action_card` in their JSON result strings:

Run: `grep -r "action_card" src/lib/capabilities/ --include="*.ts" -l`

For each match, update the handler to return `actionCard` as a typed field on the `ToolResult` instead of embedding it in the result string. The result string should remain for the LLM to read — the `actionCard` field is for the UI layer only.

Example pattern (for a capability like vault or slack):

```typescript
// Before:
return {
  result: JSON.stringify({
    success: true,
    action_card: { pattern: "vault", title: "Saved to vault", data: { ... }, handler: "vault:save" }
  })
};

// After:
return {
  result: JSON.stringify({ success: true }),
  actionCard: { pattern: "vault", title: "Saved to vault", data: { ... }, handler: "vault:save" }
};
```

**Step 1: Grep for capabilities using action_card**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && grep -rn "action_card" src/lib/capabilities/ --include="*.ts"`

**Step 2: Update each capability handler**

Move the `action_card` object out of the JSON result string and into the `actionCard` typed field.

**Step 3: Run TypeScript check + tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 4: Commit**

```bash
git add src/lib/capabilities/
git commit -m "refactor: capabilities return structured actionCard field"
```

### Task 2.3: Update chat route to use structured actionCard

**Files:**
- Modify: `src/app/api/chat/route.ts` — check `event.actionCard` instead of JSON.parse fallback

**Step 1: Update the route**

In the `chatStreamWithTools` event loop (around lines 114-147), replace the fragile JSON.parse action card detection:

```typescript
// Before (lines 120-147):
// Check if tool result contains an action card — persist to DB and emit
try {
  const parsed = JSON.parse(event.result);
  if (parsed.action_card) { ... }
} catch { }

// After:
// No need to change the tool_result SSE emission.
// But we need to handle the new actionCard field from chatStreamWithTools.
```

This requires `chatStreamWithTools` to yield `actionCard` data. Add a new event type to `ChatStreamEvent`:

In `src/lib/ai/client.ts`, extend `ChatStreamEvent`:

```typescript
export type ChatStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: string }
  | { type: "pending_change"; changeId: string }
  | { type: "action_card"; card: { pattern: string; title: string; data: Record<string, unknown>; handler?: string } };
```

Then in `chatStreamWithTools`, after receiving a tool result with `actionCard`, yield an `action_card` event:

```typescript
const { result: toolResult, pendingChangeId, actionCard } = await handleToolCall(...);
yield { type: "tool_result", toolName, result: toolResult };

if (actionCard) {
  yield { type: "action_card", card: actionCard };
}
```

Then in `route.ts`, handle the new `action_card` event from the generator (instead of fragile JSON parsing):

```typescript
} else if (event.type === "action_card") {
  const cardId = generateCardId();
  const card = await createCard({
    id: cardId,
    messageId: assistantMessageId,
    conversationId: conversationId || undefined,
    pattern: event.card.pattern as CardPattern,
    status: "pending",
    title: event.card.title,
    data: event.card.data,
    handler: event.card.handler || null,
  });
  controller.enqueue(sseEncode({ type: "action_card", card }));
}
```

Remove the old `try { JSON.parse(event.result) }` block from the `tool_result` handler.

**Step 2: Update `handleToolCall` return type**

In `src/lib/capabilities/index.ts`, update `handleToolCall` to pass through the `actionCard`:

```typescript
export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult> {
  // ... same as before, already returns ToolResult which now has actionCard?
}
```

No change needed here — `ToolResult` already includes `actionCard?` from Task 2.1.

**Step 3: Run TypeScript check + tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 4: Commit**

```bash
git add src/lib/ai/client.ts src/app/api/chat/route.ts
git commit -m "refactor: route uses structured actionCard from tool results instead of JSON.parse"
```

---

## Phase 3: Tool Dispatch Map

Currently `handleToolCall()` in `src/lib/capabilities/index.ts` iterates all capabilities linearly (O(n) per call). Replace with a pre-built `Map<toolName, Capability>` for O(1) lookup.

### Task 3.1: Build tool dispatch Map

**Files:**
- Modify: `src/lib/capabilities/index.ts`
- Test: `src/lib/capabilities/__tests__/index.test.ts`

**Step 1: Write the test**

```typescript
// src/lib/capabilities/__tests__/index.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock DB/config dependencies to avoid real DB calls
vi.mock("@/lib/config", () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/system-events", () => ({
  logCapabilityUse: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

describe("capability registry", () => {
  it("getAllTools returns tool definitions from all capabilities", async () => {
    const { getAllTools } = await import("../index");
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty("type", "function");
    expect(tools[0]).toHaveProperty("function.name");
  });

  it("handleToolCall returns error for unknown tool", async () => {
    const { handleToolCall } = await import("../index");
    const result = await handleToolCall("nonexistent_tool", {});
    expect(result.result).toContain("Unknown tool");
  });
});
```

**Step 2: Run test to verify it fails or passes (baseline)**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/capabilities/__tests__/index.test.ts`

**Step 3: Refactor handleToolCall to use Map**

```typescript
// Build tool → capability dispatch map at module load
const toolDispatchMap = new Map<string, Capability>();
for (const cap of ALL_CAPABILITIES) {
  for (const tool of cap.tools) {
    toolDispatchMap.set(tool.name, cap);
  }
}

/** Dispatch a tool call to the right capability handler */
export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult> {
  const cap = toolDispatchMap.get(toolName);
  if (!cap) {
    return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }

  const result = await cap.handleTool(toolName, toolInput, conversationId);
  if (result !== null) {
    logCapabilityUse(cap.name, toolName);
    return result;
  }

  return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
}
```

**Step 4: Run tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/capabilities/__tests__/index.test.ts`
Expected: PASS

**Step 5: Run full TypeScript check + all tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 6: Commit**

```bash
git add src/lib/capabilities/index.ts src/lib/capabilities/__tests__/index.test.ts
git commit -m "refactor: O(1) tool dispatch via Map instead of linear scan"
```

---

## Phase 4: Context Caching

`buildAgentContext()` in `src/lib/ai/context.ts` makes 4 parallel queries every message: `getRecentNotes()`, `buildMemoryContext(query)`, `getConfig('soul')`, `getCapabilityPrompts()`. The soul config and capability prompts rarely change — cache them with a TTL.

### Task 4.1: Add TTL cache for context components

**Files:**
- Create: `src/lib/ai/context-cache.ts`
- Test: `src/lib/ai/__tests__/context-cache.test.ts`
- Modify: `src/lib/ai/context.ts`

**Step 1: Write the test**

```typescript
// src/lib/ai/__tests__/context-cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTTLCache } from "../context-cache";

describe("createTTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("caches the result of the loader function", async () => {
    const loader = vi.fn().mockResolvedValue("result");
    const cache = createTTLCache(loader, 60_000);

    const r1 = await cache.get();
    const r2 = await cache.get();

    expect(r1).toBe("result");
    expect(r2).toBe("result");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refreshes after TTL expires", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const cache = createTTLCache(loader, 60_000);

    const r1 = await cache.get();
    expect(r1).toBe("first");

    vi.advanceTimersByTime(61_000);

    const r2 = await cache.get();
    expect(r2).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a refresh on next get()", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const cache = createTTLCache(loader, 60_000);

    await cache.get();
    cache.invalidate();
    const r2 = await cache.get();

    expect(r2).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/ai/__tests__/context-cache.test.ts`
Expected: FAIL

**Step 3: Implement the TTL cache**

```typescript
// src/lib/ai/context-cache.ts

export interface TTLCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

/**
 * Simple TTL cache that wraps an async loader function.
 * Calls the loader at most once per `ttlMs` period.
 */
export function createTTLCache<T>(
  loader: () => Promise<T>,
  ttlMs: number,
): TTLCache<T> {
  let cachedValue: T | undefined;
  let cachedAt = 0;

  return {
    async get(): Promise<T> {
      const now = Date.now();
      if (cachedValue !== undefined && now - cachedAt < ttlMs) {
        return cachedValue;
      }
      cachedValue = await loader();
      cachedAt = Date.now();
      return cachedValue;
    },
    invalidate() {
      cachedAt = 0;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/ai/__tests__/context-cache.test.ts`
Expected: PASS

**Step 5: Wire up caches in context.ts**

In `src/lib/ai/context.ts`, add cached versions of the slow-changing queries:

```typescript
import { createTTLCache } from './context-cache';

// Cache soul config for 5 minutes (rarely changes)
const soulConfigCache = createTTLCache(
  () => getConfig('soul').then(c => c?.content || null),
  5 * 60 * 1000,
);

// Cache capability prompts for 5 minutes (change only on deploy or config edit)
const capabilityPromptsCache = createTTLCache(
  () => getCapabilityPrompts(),
  5 * 60 * 1000,
);

// Cache recent notes for 60 seconds (changes with daily activity)
const recentNotesCache = createTTLCache(
  () => getRecentNotes(),
  60 * 1000,
);
```

Then update `buildAgentContext` to use the caches:

```typescript
const [recentNotes, memoryContext, soulConfig, capabilityPrompts] = await Promise.all([
  recentNotesCache.get(),
  buildMemoryContext(query),  // query-specific, not cacheable
  soulConfigCache.get(),
  capabilityPromptsCache.get(),
]);
```

Remove the old `soulConfigResult` intermediate variable since the cache already extracts `.content`.

**Step 6: Run TypeScript check + all tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 7: Commit**

```bash
git add src/lib/ai/context-cache.ts src/lib/ai/__tests__/context-cache.test.ts src/lib/ai/context.ts
git commit -m "perf: add TTL caching for soul config, capability prompts, and recent notes"
```

---

## Phase 5: Split Chat API Route

The route at `src/app/api/chat/route.ts` (277 lines) handles auth, history loading, context building, streaming, action card persistence, conversation saving, memory extraction, and stats. Split into focused modules.

### Task 5.1: Extract conversation persistence module

**Files:**
- Create: `src/lib/chat/persistence.ts`
- Test: `src/lib/chat/__tests__/persistence.test.ts`
- Modify: `src/app/api/chat/route.ts`

**Step 1: Write the persistence module**

```typescript
// src/lib/chat/persistence.ts
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type StoredMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

/** Load conversation history from DB. Returns empty array if not found. */
export async function loadHistory(conversationId: string): Promise<StoredMessage[]> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return (conv?.messages as StoredMessage[]) || [];
}

/** Save messages to an existing or new conversation */
export async function saveConversation(
  conversationId: string | undefined,
  messages: StoredMessage[],
): Promise<string> {
  if (conversationId) {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (existing) {
      await db
        .update(conversations)
        .set({ messages, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    } else {
      await db.insert(conversations).values({ id: conversationId, messages });
    }
    return conversationId;
  }

  const [newConv] = await db
    .insert(conversations)
    .values({ messages })
    .returning();
  return newConv.id;
}

/** Generate a stable message ID */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
```

**Step 2: Write a basic test**

```typescript
// src/lib/chat/__tests__/persistence.test.ts
import { describe, it, expect } from "vitest";
import { generateMessageId } from "../persistence";

describe("generateMessageId", () => {
  it("produces unique IDs with msg- prefix", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).toMatch(/^msg-/);
    expect(id2).toMatch(/^msg-/);
    expect(id1).not.toBe(id2);
  });
});
```

**Step 3: Run test**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/chat/__tests__/persistence.test.ts`
Expected: PASS

**Step 4: Update route.ts to import from persistence module**

Replace:
- The inline `StoredMessage` type with `import { StoredMessage, loadHistory, saveConversation, generateMessageId } from "@/lib/chat/persistence"`
- The history-loading block (lines 48-59) with `const storedHistory = conversationId ? await loadHistory(conversationId) : [];`
- The conversation-saving block (lines 175-213) with:
  ```typescript
  const newConvId = await saveConversation(conversationId, newStoredMessages);
  if (!conversationId) {
    emit({ type: "conversation", id: newConvId });
  }
  ```

**Step 5: Run TypeScript check + all tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 6: Commit**

```bash
git add src/lib/chat/persistence.ts src/lib/chat/__tests__/persistence.test.ts src/app/api/chat/route.ts
git commit -m "refactor: extract conversation persistence from chat route"
```

### Task 5.2: Slim down route.ts using extracted modules

**Files:**
- Modify: `src/app/api/chat/route.ts`

At this point the route should use:
- `sseEncode()` / `SSE_HEADERS` from Phase 1
- `loadHistory()` / `saveConversation()` / `generateMessageId()` from Task 5.1
- Structured `action_card` events from Phase 2

**Step 1: Verify the route is now a thin orchestrator**

The route's `POST` handler should now be ~100-120 lines doing:
1. Auth check
2. Parse request body
3. Load history via `loadHistory()`
4. Build context via `buildAgentContext()`
5. Create SSE stream via `createSSEStream()`
6. Stream events from `chatStreamWithTools()`
7. Handle each event type (text, tool_use, tool_result, action_card, pending_change)
8. Save conversation via `saveConversation()`
9. Fire-and-forget memory extraction + stats
10. Close stream

**Step 2: Run TypeScript check + tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 3: Commit** (if there were changes beyond 5.1)

```bash
git add src/app/api/chat/route.ts
git commit -m "refactor: slim chat route to thin orchestrator (~120 lines)"
```

---

## Phase 6: Split useChat Hook

The hook at `src/hooks/use-chat.ts` (402 lines) handles state, SSE streaming, conversation loading, polling, event processing, and action card management. Decompose into focused hooks.

### Task 6.1: Extract useSSEStream hook

**Files:**
- Create: `src/hooks/use-sse-stream.ts`
- Modify: `src/hooks/use-chat.ts`

**Step 1: Create the useSSEStream hook**

```typescript
// src/hooks/use-sse-stream.ts
"use client";

import { useState, useCallback, useRef } from "react";
import { parseSSELines } from "@/lib/sse/client";

interface UseSSEStreamOptions {
  /** Process a parsed SSE event */
  onEvent: (data: Record<string, unknown>) => void;
  /** Called on fetch/stream error */
  onError?: (error: Error) => void;
}

export function useSSEStream({ onEvent, onError }: UseSSEStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  const stream = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      setIsStreaming(true);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) throw new Error("Request failed");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSSELines(buffer, onEventRef.current);
        }

        // Process remaining buffer
        if (buffer) {
          parseSSELines(buffer + "\n", onEventRef.current);
        }
      } catch (error) {
        onErrorRef.current?.(error as Error);
      } finally {
        setIsStreaming(false);
      }
    },
    [],
  );

  return { isStreaming, stream };
}
```

**Step 2: Update useChat to use useSSEStream**

In `src/hooks/use-chat.ts`, replace the inline fetch + SSE parsing in the `send` callback with `useSSEStream`:

```typescript
const { isStreaming, stream } = useSSEStream({
  onEvent: processEvent,
  onError: (error) => {
    console.error("Chat error:", error);
    toast.error("Failed to send message");
    setHasError(true);
    setMessages((prev) => prev.slice(0, -1));
  },
});
```

Then `send` becomes:

```typescript
const send = useCallback(async (content: string) => {
  if (!content.trim() || isStreaming) return;
  streamingContentRef.current = "";
  setHasError(false);

  const userMessage = { id: generateMessageId(), role: "user" as const, content };
  const assistantMessage = { id: generateMessageId(), role: "assistant" as const, content: "" };
  currentAssistantIdRef.current = assistantMessage.id;
  setMessages((prev) => [...prev, userMessage, assistantMessage]);

  await stream("/api/chat", { message: content, conversationId, context });
}, [isStreaming, conversationId, context, stream]);
```

**Step 3: Run TypeScript check + all tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 4: Commit**

```bash
git add src/hooks/use-sse-stream.ts src/hooks/use-chat.ts
git commit -m "refactor: extract useSSEStream hook from useChat"
```

---

## Phase 7: Conversation History Management

Currently, the full conversation history is sent to the LLM every message — unbounded growth. Add a sliding window that trims the oldest messages when approaching a token budget.

### Task 7.1: Add history trimming utility

**Files:**
- Create: `src/lib/chat/history.ts`
- Test: `src/lib/chat/__tests__/history.test.ts`
- Modify: `src/app/api/chat/route.ts`

**Step 1: Write the test**

```typescript
// src/lib/chat/__tests__/history.test.ts
import { describe, it, expect } from "vitest";
import { trimHistory } from "../history";
import type { Message } from "@/lib/ai/client";

describe("trimHistory", () => {
  it("returns all messages when under budget", () => {
    const messages: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = trimHistory(messages, 10000);
    expect(result).toEqual(messages);
  });

  it("trims oldest messages when over budget", () => {
    const messages: Message[] = [
      { role: "user", content: "a".repeat(1000) },
      { role: "assistant", content: "b".repeat(1000) },
      { role: "user", content: "c".repeat(1000) },
      { role: "assistant", content: "d".repeat(1000) },
      { role: "user", content: "latest question" },
    ];
    // Budget of 600 tokens (~2400 chars) should keep only last few messages
    const result = trimHistory(messages, 600);
    // Should always keep the latest user message
    expect(result[result.length - 1].content).toBe("latest question");
    // Should have dropped some older messages
    expect(result.length).toBeLessThan(messages.length);
  });

  it("always keeps at least the last user message", () => {
    const messages: Message[] = [
      { role: "user", content: "a".repeat(10000) },
    ];
    const result = trimHistory(messages, 10); // impossibly small budget
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("a".repeat(10000));
  });

  it("preserves message pairs (user+assistant together)", () => {
    const messages: Message[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "new" },
      { role: "assistant", content: "new reply" },
      { role: "user", content: "latest" },
    ];
    const result = trimHistory(messages, 100);
    // If trimmed, should not leave orphaned assistant without user
    const roles = result.map(m => m.role);
    // First message should be "user" (not orphaned "assistant")
    expect(roles[0]).toBe("user");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/chat/__tests__/history.test.ts`
Expected: FAIL

**Step 3: Implement trimHistory**

```typescript
// src/lib/chat/history.ts
import type { Message } from "@/lib/ai/client";

/** Rough character-to-token ratio (~4 chars per token for English) */
const CHARS_PER_TOKEN = 4;

/**
 * Trim conversation history to fit within a token budget.
 * Drops the oldest message pairs first, always keeping at least the
 * most recent user message.
 *
 * @param messages - Conversation messages (user/assistant alternating)
 * @param maxTokens - Maximum token budget for history (default 8000)
 */
export function trimHistory(messages: Message[], maxTokens: number = 8000): Message[] {
  if (messages.length === 0) return messages;

  const estimateTokens = (msgs: Message[]) =>
    Math.ceil(msgs.reduce((sum, m) => sum + m.content.length, 0) / CHARS_PER_TOKEN);

  // If within budget, return as-is
  if (estimateTokens(messages) <= maxTokens) return messages;

  // Always keep at least the last message
  let startIdx = 0;

  // Drop from the front in pairs (user+assistant) until within budget
  while (startIdx < messages.length - 1) {
    const remaining = messages.slice(startIdx);
    if (estimateTokens(remaining) <= maxTokens) break;

    // Skip forward by 2 (one pair) if possible
    if (startIdx + 2 <= messages.length - 1) {
      startIdx += 2;
    } else {
      startIdx += 1;
    }
  }

  const trimmed = messages.slice(startIdx);

  // Ensure first message is from "user" (don't leave orphaned assistant)
  if (trimmed.length > 0 && trimmed[0].role === "assistant") {
    return trimmed.slice(1);
  }

  return trimmed;
}
```

**Step 4: Run test to verify it passes**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx vitest run src/lib/chat/__tests__/history.test.ts`
Expected: PASS

**Step 5: Wire up in route.ts**

In `src/app/api/chat/route.ts`, after converting stored history to AI messages:

```typescript
import { trimHistory } from "@/lib/chat/history";

// Convert stored history to AI message format
const aiHistory: Message[] = storedHistory.map((m) => ({
  role: m.role,
  content: m.content,
}));

// Trim history to fit token budget (8000 tokens for history, leaving room for system prompt + response)
const trimmedHistory = trimHistory(aiHistory, 8000);

const aiMessages: Message[] = [
  ...trimmedHistory,
  { role: "user", content: message },
];
```

**Step 6: Run TypeScript check + all tests**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit && npx vitest run`

**Step 7: Commit**

```bash
git add src/lib/chat/history.ts src/lib/chat/__tests__/history.test.ts src/app/api/chat/route.ts
git commit -m "feat: add conversation history trimming with token budget"
```

---

## Final Verification

After all 7 phases:

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq"
npx tsc --noEmit          # TypeScript compilation
npx vitest run            # All tests
```

Expected: All pass, no regressions.

## Summary of New/Modified Files

**New files:**
- `src/lib/sse/server.ts` — Server-side SSE encoding utilities
- `src/lib/sse/client.ts` — Client-side SSE parsing utilities
- `src/lib/sse/__tests__/server.test.ts`
- `src/lib/sse/__tests__/client.test.ts`
- `src/lib/ai/context-cache.ts` — Generic TTL cache
- `src/lib/ai/__tests__/context-cache.test.ts`
- `src/lib/chat/persistence.ts` — Conversation load/save
- `src/lib/chat/__tests__/persistence.test.ts`
- `src/lib/chat/history.ts` — Token-aware history trimming
- `src/lib/chat/__tests__/history.test.ts`
- `src/hooks/use-sse-stream.ts` — Generic SSE streaming hook
- `src/lib/capabilities/__tests__/index.test.ts`

**Modified files:**
- `src/lib/capabilities/types.ts` — Added `actionCard?` to ToolResult
- `src/lib/capabilities/index.ts` — Map-based tool dispatch
- `src/lib/ai/client.ts` — Added `action_card` event type to ChatStreamEvent
- `src/lib/ai/context.ts` — Uses TTL caches
- `src/app/api/chat/route.ts` — Thin orchestrator using extracted modules
- `src/hooks/use-chat.ts` — Uses useSSEStream, parseSSELines
- `src/components/aurelius/task-creator-panel.tsx` — Uses parseSSELines
- Various capability handlers — Return structured actionCard instead of embedding in result string
