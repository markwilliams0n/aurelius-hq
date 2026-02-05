# Memory Debug Mode Design

> Debug overlay and instrumentation for understanding memory operations — what was saved, recalled, why, and how well.

## Problem

The memory system operates as a black box. When Ollama extracts entities, when chat recalls memory, when heartbeat processes daily notes — there's no visibility into what happened, what was chosen, or why. To improve memory quality, we need to see inside every operation.

## Goals

1. **Understand every memory operation** — what triggered it, what data went in/out, why decisions were made
2. **Debug from anywhere** — CMD+M overlay shows recent memory activity without navigating away
3. **Systematic improvement** — historical event data enables analysis of what's working and what's not
4. **Quality evaluation** — optional debug mode runs an evaluator pass that critiques extraction quality

## Design

### Memory Events Table

Every memory operation writes an event row. This is the foundation — all UI reads from this.

```sql
memory_events
├── id              UUID (primary key)
├── timestamp       timestamptz (default now)
├── eventType       text — 'recall' | 'extract' | 'save' | 'search' | 'reindex' | 'evaluate'
├── trigger         text — 'chat' | 'heartbeat' | 'triage' | 'manual' | 'api'
├── triggerId       text (nullable) — links to chat message ID, heartbeat run ID, triage item ID
├── summary         text — one-liner description
├── payload         jsonb — full operation details (search results, extracted facts, Ollama response, prompt context)
├── reasoning       jsonb — per-item reasoning from extraction prompts
├── evaluation      jsonb (nullable) — debug evaluator output (only when debug mode ON)
├── durationMs      integer — operation duration
├── metadata        jsonb — extra context (model used, collection, connector source)
```

**Key properties:**
- `payload` stores the complete picture — raw Ollama output, search results with scores, assembled prompt context
- `reasoning` is always populated (baked into extraction prompts, free with local Ollama)
- `evaluation` only populated when debug mode is on
- `triggerId` enables tracing: "this chat message caused these 3 memory events"

### In-Memory Buffer

Last ~100 events held in a process-level array for instant overlay access. New events push to both the buffer and the DB (async, fire-and-forget). The buffer is lost on server restart; the DB is the source of truth.

### Instrumentation Points

Each memory operation gets a lightweight `emitMemoryEvent()` call added alongside existing logic. No refactoring of the memory system itself.

**Recall events (memory read):**
- `buildMemoryContext()` in `context.ts` — chat context building. Captures: search query, QMD results with scores, what was included in the prompt vs cut, timing.
- `searchMemory()` in `search.ts` — explicit API search. Captures: query, search type, collection, results, scores.

**Extract events (LLM processing):**
- `extractEmailMemory()` in `ollama.ts` — triage save-to-memory. Captures: input content, extracted entities/facts/actions, reasoning per item, what was filtered by dedup.
- `extractEntitiesWithLLM()` in `ollama.ts` — heartbeat extraction. Captures: daily note section, entities found, reasoning.
- `extractAndSaveMemories()` in `extraction.ts` — post-chat auto-extraction. Captures: conversation snippet, what was deemed notable, what was saved.

**Save events (memory write):**
- `appendToDailyNote()` in `daily-notes.ts` — write to daily notes. Captures: formatted entry, source, file path.
- `createEntity()` / `addFactToEntity()` in `heartbeat.ts` — entity creation/update. Captures: entity name/type, facts added, facts deduplicated and why.

**System events:**
- QMD `update`/`embed` — reindex. Captures: duration, files indexed, errors.

### Ollama Prompt Changes

Extraction prompts are modified to return a `reasoning` field alongside each entity/fact:

```json
{
  "entities": [
    {
      "name": "John Smith",
      "type": "person",
      "facts": ["Leads Q3 planning initiative"],
      "reasoning": "Mentioned by name as leading a specific project with concrete details"
    }
  ],
  "skipped": [
    {
      "item": "the project",
      "reasoning": "Too vague — no specific project name or details to anchor this"
    }
  ]
}
```

This costs nothing with local Ollama and is always captured, regardless of debug mode.

### Debug Mode

Two layers: always-on instrumentation, and a toggle for deeper analysis.

**Always on (no toggle):**
- Every memory operation emits an event with full payload + reasoning
- CMD+M overlay works anytime
- Memory page shows historical events

**Debug mode ON (explicit toggle):**
- Toggle in CMD+M overlay header or Memory page
- Extraction operations get a second Ollama evaluator pass
- Small persistent indicator in the app shell (e.g., a dot in the header/nav) so you always know it's active

**The evaluator** receives the original input + what was extracted + what was filtered, and returns:

```json
{
  "score": 4,
  "missed": ["The email mentions a deadline of March 15 — not captured as a fact"],
  "weak": ["'John mentioned the project' is too vague to be useful"],
  "good": ["Revenue figure $2.3M is specific and correctly attributed to Q3"],
  "suggestions": ["Consider extracting the relationship between John and Q3 project"]
}
```

The evaluator output is stored in the event's `evaluation` field and shown in expanded event cards.

### CMD+M Overlay

Global keyboard shortcut, available from anywhere in the app.

**Appearance:** Slide-out panel from the right (consistent with existing tool panel pattern). Not a modal — stays open while you use the app. Send a chat message, watch events appear in real-time.

```
┌─────────────────────────────────┐
│ Memory Debug         [ON/OFF] X │
│─────────────────────────────────│
│                                 │
│ ▸ 2:34 PM  Recalled memory     │
│   chat: "what did John say?"    │
│                                 │
│ ▸ 2:34 PM  Wrote memory        │
│   extracted 2 facts from chat   │
│                                 │
│ ▸ 2:19 PM  Heartbeat extract   │
│   3 entities from daily notes   │
│                                 │
│ ▸ 2:15 PM  Triage → memory     │
│   "Re: Q3 planning" → 4 facts  │
│                                 │
│         View all →  (Memory pg) │
└─────────────────────────────────┘
```

**Behavior:**
- Shows last ~20 events from in-memory buffer
- New events animate in at top (SSE or short polling)
- Click to expand inline — shows payload, reasoning, evaluation
- Debug mode toggle in header
- "View all" links to Memory page
- Remembers open/closed state

**Expanded event:**
```
▾ 2:34 PM  Recalled memory
  Trigger: chat message "what did John say?"
  Search: hybrid on life/ collection
  Duration: 5.2s

  Results (5):
  1. life/areas/people/john-smith/summary.md  (0.82)
     "John mentioned Q3 revenue targets..."
  2. life/projects/q3-planning/summary.md     (0.71)
     ...

  Included in prompt: results 1-3 (truncated at 2000 tokens)

  [Debug] Evaluation:
  Score: 4/5
  "Good recall — top result is highly relevant.
   Result #4 about a different John may be noise."
```

### Memory Page

Persistent page for deep inspection and historical analysis.

**Three tabs:**

1. **Feed** — chronological event stream from DB. Filterable by event type (recall/extract/save) and trigger (chat/heartbeat/triage). Searchable. Grouped by day. Same expandable cards as overlay but with full history.

2. **Entities** — browse all entities in `life/`. Fact counts, last accessed, access frequency. Click into an entity to see its facts, when each was added, source, evaluator flags.

3. **Stats** — systematic improvement view:
   - Facts extracted vs facts recalled (dead weight detection)
   - Extraction quality scores over time
   - Most/least accessed entities
   - Connector breakdown (which source produces useful memory)
   - Dedup rate

Feed tab is the priority. Entities and Stats come later as event data accumulates.

### Debug Mode Indicator

When debug mode is on, a small visual indicator appears in the app shell — visible from any page. Something like a small colored dot or badge near the navigation. Subtle but always present so you know the evaluator is running.

## Implementation Phases

### Phase 1 — Foundation
- `memory_events` DB table + Drizzle schema + migration
- `emitMemoryEvent()` utility (in-memory buffer + async DB write)
- Instrument top 3 operations: `buildMemoryContext()`, `extractEmailMemory()`, heartbeat extraction
- Modify Ollama extraction prompts to include `reasoning` field

### Phase 2 — Overlay UI
- CMD+M global keyboard shortcut (app shell level)
- Slide-out panel with event feed from buffer
- Expandable event cards with payload + reasoning
- Live updates (SSE endpoint or short polling)
- Debug mode toggle + app shell indicator

### Phase 3 — Debug Evaluator
- Evaluator Ollama prompt
- Wired into extraction functions, gated by debug mode flag
- Evaluation stored in event `evaluation` field
- Shown in expanded event cards

### Phase 4 — Memory Page
- Feed tab (DB query, filters, search, day grouping)
- Remaining instrumentation points (daily note writes, QMD reindex, post-chat extraction)
- Entities and Stats tabs later

### Not building yet
- Stats tab
- Retention / cleanup policies
- Event data export
- Alerting on low quality scores
