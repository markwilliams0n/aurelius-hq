# Daily Notes Direct Context Design

**Date:** 2026-02-02
**Status:** Approved

## Problem

Memories added to daily notes aren't searchable until QMD reindexes (every 15 minutes via heartbeat). This creates a gap where the AI can't recall recent conversations.

## Solution

Include recent daily notes directly in chat context, bypassing QMD for the last 24 hours.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Time window | Rolling 24 hours (today + yesterday if before noon) |
| QMD integration | Recent in context directly, QMD only for older content |
| Content format | Full content, no summarization |
| Prompt placement | Separate labeled section: "## Recent Activity (Last 24 Hours)" |

## Architecture

**Current flow:**
```
User message → buildMemoryContext() → QMD search → System prompt → AI
```

**New flow:**
```
User message → getRecentNotes() → buildMemoryContext() → System prompt → AI
                     ↓                      ↓
              Direct file read         QMD search (life/ only)
                     ↓                      ↓
              "## Recent Activity"    "## Relevant Memory"
```

## Implementation

### 1. New function: `getRecentNotes()`

**File:** `src/lib/memory/daily-notes.ts`

```typescript
interface RecentNotesOptions {
  maxTokens?: number;  // Default ~2000
}

export async function getRecentNotes(options?: RecentNotesOptions): Promise<string | null>
```

- Reads today's daily note
- If current hour < 12 (noon), also reads yesterday's note
- Concatenates with clear date headers
- Truncates from top (oldest entries) if exceeding maxTokens
- Returns null if no notes exist

### 2. Modify `buildMemoryContext()`

**File:** `src/lib/memory/search.ts`

```typescript
interface BuildContextOptions {
  limit?: number;
  excludeCollections?: string[];  // NEW
}

export async function buildMemoryContext(
  query: string,
  options?: BuildContextOptions
): Promise<string | null>
```

- Add option to exclude collections from QMD search
- Chat will call with `excludeCollections: ['memory']`

### 3. Update chat route

**File:** `src/app/api/chat/route.ts`

- Call `getRecentNotes()` before `buildMemoryContext()`
- Pass `excludeCollections: ['memory']` to avoid duplicates
- Assemble prompt:
  ```
  ## Recent Activity (Last 24 Hours)
  [direct daily notes content]

  ## Relevant Memory
  [QMD search results from life/]
  ```

## Documentation Changes

### New file structure

```
docs/
├── systems/              # Core system documentation
│   ├── memory.md         # Memory system overview (NEW)
│   ├── daily-notes.md    # Daily notes documentation (NEW)
│   ├── heartbeat.md      # Moved from docs/
│   └── triage.md         # Moved from docs/
├── connectors/           # Keep as-is
├── plans/                # Keep as-is
├── roadmap/              # Keep as-is
├── worklog/              # Keep as-is
└── PROGRESS.md           # Keep at root
```

### Files to update

References to moved docs need updating in:
- `ARCHITECTURE.md`
- `CLAUDE.md`
- Any cross-references in other docs

### Archive candidates

- `docs/memory-architecture-discussion.md` - Reference in new memory.md or archive
- `docs/memory-v2-implementation.md` - Same treatment

## Token Budget

- Recent notes: ~2000 tokens max (truncated if exceeded)
- QMD results: unchanged
- Total context increase: minimal on typical days

## Testing

1. Chat immediately after heartbeat - verify both recent notes and QMD results appear
2. Chat about something from 5 minutes ago - verify it's in "Recent Activity"
3. Chat about something from a week ago - verify it comes from QMD "Relevant Memory"
4. Check behavior at noon boundary - yesterday should drop off after 12pm
