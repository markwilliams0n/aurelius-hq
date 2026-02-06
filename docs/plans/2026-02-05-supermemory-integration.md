# Supermemory Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Aurelius' extraction + search pipeline with Supermemory's hosted API, eliminating Ollama extraction, QMD search, entity resolution, and the `life/` file-based entity storage. Keep triage connectors, daily notes, heartbeat (for connector syncing), and the chat flow.

**Architecture:** Supermemory becomes the single memory backend. Content goes in via `client.add()` after chat messages and triage saves. Context comes out via `client.search()` or `client.profile()` before chat responses. The heartbeat retains connector sync steps but drops entity extraction and QMD reindexing.

**Tech Stack:** `supermemory` npm package, Supermemory cloud API ($19/mo Pro tier)

**Research docs:**
- `docs/research/supermemory-evaluation.md` — Deep evaluation, API surface, side-by-side comparison
- `docs/research/memory-service-comparison.md` — Full landscape comparison (Supermemory vs Mem0 vs Zep vs others)

**Fallback:** If Supermemory extraction quality disappoints for our use cases (email metrics, meeting decisions), fall back to upgrading the extraction LLM from llama3.2:3b to Claude Haiku or GPT-4o-mini (~$5-10/mo) in the existing pipeline. This plan is designed so the fallback is easy — we keep daily notes and the conversation flow intact.

---

## Context for the Implementer

### What Supermemory Is

Cloud-hosted memory API. You send content, it extracts memories, builds a knowledge graph, returns context on search. Three key API calls:

```typescript
import Supermemory from "supermemory";
const client = new Supermemory(); // reads SUPERMEMORY_API_KEY env var

// 1. Store memory
await client.add({
  content: "Meeting with Adam about Q3 planning. Decided to focus on enterprise.",
  containerTag: "mark",
  metadata: { source: "granola" }
});

// 2. Get user profile + relevant context
const context = await client.profile({
  containerTag: "mark",
  q: "What did Adam say about Q3?"
});
// Returns: { static: [...], dynamic: [...], results: [...] }

// 3. Search
const results = await client.search.documents({
  q: "Q3 revenue targets",
  containerTag: "mark",
  searchMode: "hybrid",
  rerank: true
});
```

Supermemory handles extraction, dedup, knowledge graph, and indexing automatically. We just feed it content and ask it questions.

### What We're Replacing

These files/systems get removed or heavily simplified:

| File | Current Purpose | What Happens |
|------|----------------|--------------|
| `src/lib/memory/ollama.ts` | LLM entity extraction (llama3.2:3b) | **Remove entirely** |
| `src/lib/memory/entity-resolution.ts` | Multi-signal entity matching | **Remove entirely** |
| `src/lib/memory/search.ts` | QMD CLI hybrid search | **Rewrite** — calls Supermemory instead of QMD |
| `src/lib/memory/heartbeat.ts` | 8-step sync orchestrator | **Simplify** — keep connector syncs, remove extraction + QMD steps |
| `src/lib/memory/synthesis.ts` | Memory decay, entity summaries | **Remove entirely** (Supermemory handles) |
| `src/lib/memory/evaluator.ts` | Extraction quality evaluation | **Remove entirely** |
| `life/` directory | File-based entity storage | **Archive/remove** — Supermemory is the store |
| QMD CLI binary | Hybrid search engine | **Remove dependency** |

### What We're Keeping

| File | Purpose | Changes |
|------|---------|---------|
| `src/lib/memory/daily-notes.ts` | Rolling 24h conversation log | **No change** — still useful as raw short-term context |
| `src/lib/memory/extraction.ts` | Post-chat save to daily notes | **Modify** — also send to Supermemory after saving to daily notes |
| `src/lib/memory/events.ts` | Memory event instrumentation | **Adapt** — instrument Supermemory calls instead of QMD/Ollama |
| `src/lib/memory/entities.ts` | DB entity CRUD | **Keep for now** — may be needed for triage entity linking |
| `src/lib/memory/facts.ts` | DB fact CRUD | **Keep for now** — same reason |
| `src/lib/ai/context.ts` | Builds system prompt context | **Modify** — call Supermemory profile instead of buildMemoryContext |
| `src/app/api/chat/route.ts` | Chat endpoint | **No change** — still calls buildAgentContext |
| Triage connectors (Gmail, Granola, Linear, Slack) | Feed inbox | **No change** — these stay |
| Heartbeat connector sync steps | Sync Gmail/Granola/Linear/Slack | **Keep these steps** |
| Debug mode overlay (CMD+D) | Memory event visualization | **Adapt** — show Supermemory events instead |

### Key Architecture Decision

**Daily notes remain as short-term context.** The chat route still reads the last 24h of daily notes directly from files for immediate context. Supermemory provides the long-term memory layer (searchable knowledge graph). This gives us both recency and depth.

```
Chat message arrives
    ↓
buildAgentContext():
  1. getRecentNotes()         ← file read, last 24h (unchanged)
  2. supermemory.profile(q)   ← NEW: replaces buildMemoryContext/QMD
  3. getConfig('soul')        ← unchanged
    ↓
Stream AI response
    ↓
extractAndSaveMemories():
  1. appendToDailyNote()      ← unchanged
  2. supermemory.add(content)  ← NEW: feed conversation to Supermemory
```

---

## Task 1: Install Supermemory SDK + Create Client Module

**Files:**
- Create: `src/lib/memory/supermemory.ts`
- Modify: `.env.local` (add API key)

**Step 1: Install the package**

Run: `bun add supermemory`

**Step 2: Create the client module**

Create `src/lib/memory/supermemory.ts`:

```typescript
import Supermemory from "supermemory";

const CONTAINER_TAG = "mark"; // Single-user, hardcoded for now

let client: Supermemory | null = null;

function getClient(): Supermemory {
  if (!client) {
    if (!process.env.SUPERMEMORY_API_KEY) {
      throw new Error("SUPERMEMORY_API_KEY not set");
    }
    client = new Supermemory();
  }
  return client;
}

/**
 * Send content to Supermemory for extraction + indexing.
 * Call after chat messages, triage saves, connector syncs.
 */
export async function addMemory(
  content: string,
  metadata?: Record<string, string>
): Promise<void> {
  const sm = getClient();
  await sm.add({
    content,
    containerTag: CONTAINER_TAG,
    metadata,
  });
}

/**
 * Get user profile + relevant context for a query.
 * Primary retrieval method for chat context building.
 */
export async function getMemoryContext(
  query: string
): Promise<{ static: string[]; dynamic: string[]; results: unknown[] }> {
  const sm = getClient();
  const response = await sm.profile({
    containerTag: CONTAINER_TAG,
    q: query,
  });
  return response;
}

/**
 * Search memories directly. For memory browser UI and triage enrichment.
 */
export async function searchMemories(
  query: string,
  limit: number = 10
): Promise<unknown[]> {
  const sm = getClient();
  const response = await sm.search.documents({
    q: query,
    containerTag: CONTAINER_TAG,
    limit,
    searchMode: "hybrid",
    rerank: true,
  });
  return response.results ?? [];
}
```

**Step 3: Add env var**

Add to `.env.local`:
```
SUPERMEMORY_API_KEY=your-api-key-here
```

**Step 4: Verify it builds**

Run: `bun run build` (or `bunx tsc --noEmit`)
Expected: No type errors

**Step 5: Commit**

```bash
git add src/lib/memory/supermemory.ts
git commit -m "feat: add Supermemory client module"
```

---

## Task 2: Rewrite Context Building to Use Supermemory

**Files:**
- Modify: `src/lib/ai/context.ts` (lines ~53-108, `buildAgentContext`)
- Modify: `src/lib/memory/search.ts` (`buildMemoryContext` — rewrite to call Supermemory)

**Step 1: Rewrite `buildMemoryContext` in search.ts**

Replace the QMD-based implementation with a Supermemory call. Keep the same function signature so callers don't change.

The current function (search.ts:270-328) calls `searchMemory()` which shells out to `qmd query`. Replace the body to call `getMemoryContext()` from the new supermemory module and format results into the same string format the system prompt expects.

**Step 2: Verify context.ts still works**

`buildAgentContext` in context.ts calls `buildMemoryContext(query, { collection: 'life' })`. After the rewrite, this call should transparently use Supermemory. The collection parameter can be ignored (Supermemory uses containerTag for isolation).

**Step 3: Test manually**

Start the dev server, open chat, send a message. Check that:
- No QMD errors in console
- System prompt includes memory context (may be empty initially until Supermemory has data)
- Response streams normally

**Step 4: Commit**

```bash
git commit -m "feat: replace QMD search with Supermemory for chat context"
```

---

## Task 3: Feed Chat Conversations to Supermemory

**Files:**
- Modify: `src/lib/memory/extraction.ts` (lines ~9-41, `extractAndSaveMemories`)

**Step 1: Add Supermemory call to extraction.ts**

After the existing `appendToDailyNote()` call, add a call to `addMemory()` from the supermemory module. Send both the user message and assistant response as content.

```typescript
// After appendToDailyNote:
await addMemory(
  `User: ${userMessage}\nAssistant: ${assistantResponse}`,
  { source: "chat" }
);
```

Keep the daily note append — it's still used for short-term (24h) context.

**Step 2: Remove Ollama extraction from this function**

The current function calls `extractSemanticNote()` from ollama.ts for a richer note format. Replace this with a simpler format since Supermemory handles the extraction. Just save the raw conversation turn to the daily note.

**Step 3: Test**

Send a chat message. Verify:
- Daily note still gets appended
- No Ollama errors (it's no longer called)
- Supermemory add call succeeds (check network/logs)

**Step 4: Commit**

```bash
git commit -m "feat: feed chat conversations to Supermemory"
```

---

## Task 4: Feed Triage Saves to Supermemory

**Files:**
- Find the triage "save to memory" handler (likely in triage API routes or triage actions)
- Modify to also call `addMemory()` with the enriched content

**Step 1: Find the save-to-memory flow**

Search for where triage items get saved to memory. This is the `Shift+↑` (memory + archive) flow. It currently saves rich content to daily notes, which heartbeat later processes.

**Step 2: Add Supermemory call**

After the daily note save, also send the enriched content to Supermemory:

```typescript
await addMemory(enrichedContent, {
  source: item.source, // "gmail", "granola", "linear", "slack"
  itemId: item.id,
});
```

**Step 3: Test**

Save a triage item to memory. Verify the Supermemory call fires.

**Step 4: Commit**

```bash
git commit -m "feat: feed triage saves to Supermemory"
```

---

## Task 5: Simplify Heartbeat — Remove Extraction + QMD Steps

**Files:**
- Modify: `src/lib/memory/heartbeat.ts` (1,084 lines → significantly smaller)

This is the biggest change. The heartbeat currently does 8 steps. We keep 5 (backup + 4 connector syncs) and remove 3 (entity extraction, QMD update, QMD embed).

**Step 1: Remove entity extraction step (lines ~558-811)**

This is the bulk of heartbeat — parsing daily notes, calling Ollama, resolving entities, writing to `life/` files. All of this is now handled by Supermemory when we call `addMemory()` in Tasks 3 and 4.

Remove or comment out the entire entity extraction block. Keep the step logging so the heartbeat UI still shows progress.

**Step 2: Remove QMD update step (lines ~948-973)**

Remove the `qmd update` shell call. Supermemory indexes on add.

**Step 3: Remove QMD embed step (lines ~975-1006)**

Remove the `qmd embed` shell call. Supermemory handles embeddings.

**Step 4: Optionally add a Supermemory sync step**

Consider adding a step that sends any unprocessed daily note content to Supermemory (for content that was written to daily notes but not yet sent to Supermemory — e.g., if the app restarted between daily note write and Supermemory call). This is a safety net.

**Step 5: Test heartbeat**

Trigger a manual heartbeat from the System page. Verify:
- Connector syncs still work (Gmail, Granola, Linear, Slack)
- No Ollama or QMD errors
- Heartbeat completes faster (no extraction or indexing steps)
- UI shows reduced step count

**Step 6: Commit**

```bash
git commit -m "feat: simplify heartbeat — remove extraction and QMD steps"
```

---

## Task 6: Update Memory Search API + Browser UI

**Files:**
- Modify: `src/app/api/memory/search/route.ts` — use Supermemory search
- Modify: memory browser page components — adapt to Supermemory's data format

**Step 1: Update search API route**

Replace QMD calls with `searchMemories()` from the supermemory module. Keep the same response format for the UI.

**Step 2: Update memory browser**

The current memory browser reads from `life/` entity files via `getAllMemory()`. This needs to either:
- Show Supermemory search results instead
- Or be simplified to a search-only interface (no file tree browsing)

**Step 3: Update triage enrichment**

`src/lib/triage/enrichment.ts` calls `searchMemory()` for entity linking. Update to use Supermemory search.

**Step 4: Test the memory page**

Verify search works, results display correctly.

**Step 5: Commit**

```bash
git commit -m "feat: update memory UI and API to use Supermemory"
```

---

## Task 7: Update Debug Mode Events

**Files:**
- Modify: `src/lib/memory/events.ts` — update event types if needed
- Modify: anywhere `emitMemoryEvent()` is called — update payloads

**Step 1: Update event emissions**

Replace extraction/QMD events with Supermemory-specific events:
- `recall` events now show Supermemory profile/search calls + latency
- `save` events now show Supermemory add calls
- Remove `reindex` events (no longer relevant)
- Remove `extract` events from heartbeat (no longer extracting)

**Step 2: Verify CMD+D overlay**

Open debug mode, perform chat actions, verify events stream correctly with Supermemory metadata.

**Step 3: Commit**

```bash
git commit -m "feat: adapt debug mode events for Supermemory"
```

---

## Task 8: Clean Up Removed Code

**Files to remove:**
- `src/lib/memory/ollama.ts` — no longer needed (extraction handled by Supermemory)
- `src/lib/memory/entity-resolution.ts` — no longer needed
- `src/lib/memory/synthesis.ts` — no longer needed (Supermemory manages graph)
- `src/lib/memory/evaluator.ts` — no longer needed

**Files to simplify:**
- `src/lib/memory/search.ts` — remove all QMD functions, keep only the Supermemory wrappers
- `src/lib/memory/index.ts` — update exports

**Dependencies to remove:**
- QMD CLI binary (however it's installed/referenced)
- Any Ollama-specific env vars that are no longer used

**Directories to archive:**
- `life/` — move to `life-archive/` or remove. This data is now in Supermemory.

**Step 1: Remove the files**

Delete `ollama.ts`, `entity-resolution.ts`, `synthesis.ts`, `evaluator.ts`.

**Step 2: Fix all imports**

Search for imports from deleted files and remove/update them. Key places:
- heartbeat.ts imports from ollama.ts and entity-resolution.ts
- Various files may import from synthesis.ts

**Step 3: Remove QMD references**

Search the codebase for "qmd" and remove all references.

**Step 4: Verify build**

Run: `bun run build`
Expected: Clean build, no missing import errors

**Step 5: Run any existing tests**

Run: `bun test` (or however tests are configured)
Expected: Tests pass (some may need updating if they tested extraction)

**Step 6: Commit**

```bash
git commit -m "chore: remove Ollama extraction, QMD, entity resolution — now using Supermemory"
```

---

## Task 9: Seed Supermemory with Existing Knowledge

**This is a one-time migration task.**

The `life/` directory contains existing entity knowledge that should be seeded into Supermemory.

**Step 1: Write a seed script**

Create `scripts/seed-supermemory.ts` that:
1. Reads all entity directories from `life/`
2. For each entity, reads `summary.md` and `items.json`
3. Formats as text: "Entity: {name}\nType: {type}\n{summary}\nFacts:\n- {fact1}\n- {fact2}..."
4. Calls `addMemory(content, { source: "migration" })`
5. Logs progress

**Step 2: Run it**

Run: `bun run scripts/seed-supermemory.ts`

This may take a few minutes depending on how many entities exist. Supermemory processes async.

**Step 3: Verify**

Search for a known entity in chat. Verify Supermemory returns relevant context.

**Step 4: Commit the script**

```bash
git commit -m "feat: add Supermemory seed script for existing entity migration"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `ARCHITECTURE.md` — update memory system description
- Modify: `docs/worklog/now.md` — capture what changed
- Modify: `docs/systems/memory.md` — rewrite for new architecture

**Step 1: Update ARCHITECTURE.md**

Replace the Memory System section:
- Remove references to QMD, Ollama, `life/` directory
- Add Supermemory as the memory backend
- Update the "Three storage layers" table to reflect new architecture
- Update heartbeat description (connector syncing only)

**Step 2: Update memory.md**

Rewrite `docs/systems/memory.md` to reflect the simplified architecture:
- Short-term: daily notes (file-based, last 24h)
- Long-term: Supermemory (cloud API, knowledge graph)
- No more entity files, QMD, or Ollama extraction

**Step 3: Commit**

```bash
git commit -m "docs: update architecture docs for Supermemory integration"
```

---

## Order of Operations

Tasks 1-4 are additive (new code alongside old). Tasks 5-8 are subtractive (removing old code). Task 9 is migration. Task 10 is docs.

**Safe sequence:**
1. Task 1 (SDK + client) — no impact on existing system
2. Task 9 (seed data) — can run early so Supermemory has data to search
3. Task 2 (context building) — switches reads to Supermemory
4. Task 3 (chat feed) — switches writes for chat
5. Task 4 (triage feed) — switches writes for triage
6. Task 5 (simplify heartbeat) — removes extraction
7. Task 6 (search UI) — updates memory browser
8. Task 7 (debug events) — adapts instrumentation
9. Task 8 (cleanup) — removes dead code
10. Task 10 (docs) — captures the new state

After Task 5, the old extraction pipeline is fully bypassed. Tasks 6-8 are cleanup. The system should be functional after Tasks 1-5.

---

## Environment Setup

Before starting, you need:

1. **Supermemory account** — Sign up at supermemory.ai, get an API key
2. **Pro plan ($19/mo)** — Free tier (1M tokens) may work for initial dev, but Pro (3M tokens, 100K searches) for production
3. **Add to .env.local:**
   ```
   SUPERMEMORY_API_KEY=sm_...
   ```

---

## Verification Checklist

After all tasks, verify:

- [ ] Chat messages get sent to Supermemory (`addMemory` after each conversation)
- [ ] Chat context includes Supermemory results (check system prompt in debug mode)
- [ ] Triage "save to memory" sends content to Supermemory
- [ ] Heartbeat runs without Ollama/QMD errors
- [ ] Heartbeat still syncs Gmail, Granola, Linear, Slack
- [ ] Memory search page returns Supermemory results
- [ ] Debug mode (CMD+D) shows Supermemory events
- [ ] No references to QMD, Ollama extraction, or `life/` in active code
- [ ] Build passes cleanly (`bun run build`)
- [ ] Existing tests pass or are updated
- [ ] Daily notes still work (short-term context unchanged)
