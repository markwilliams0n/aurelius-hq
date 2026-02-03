# Memory System Review & Recommendations

**Date:** 2026-02-02
**Status:** Analysis Complete

## Executive Summary

The Aurelius memory system has two parallel storage mechanisms that don't fully synchronize:

1. **Database** (PostgreSQL + Drizzle) - Fast, semantic search, real-time
2. **File System** (life/ + memory/) - Human-readable, version-controlled, Ollama-powered extraction

This session fixed several issues and added improvements. This document summarizes the work and recommends future improvements.

## Issues Fixed This Session

### 1. Search Results Showing Git Diff Markers ✅
**Problem:** QMD search returns snippets with `@@ -1,3 @@ (0 before, 6 after)` format.
**Fix:** Added `cleanQmdSnippet()` and `cleanQmdPath()` functions to strip diff markers and use proper file paths.
**File:** `src/lib/memory/search.ts`

### 2. Daily Notes Quality Poor ✅
**Problem:** Chat conversations dumped verbatim; triage items just showed "X facts extracted".
**Fix:**
- Use Ollama for semantic extraction in chat (`extractSemanticNote()`)
- Include actual extracted facts in triage notes
**Files:** `src/lib/memory/extraction.ts`, `src/app/api/triage/[id]/memory/route.ts`

### 3. Synthesis Not Scheduled ✅
**Problem:** Memory decay/synthesis only ran manually.
**Fix:** Added daily scheduling at 3 AM via node-cron.
**Files:** `src/lib/scheduler.ts`, `src/instrumentation.ts`

### 4. Sidebar Scroll Issues ✅ (Earlier in session)
**Problem:** Sidebars scrolled the entire page.
**Fix:** Created reusable `RightSidebar` component with proper height constraints.
**Files:** `src/components/aurelius/right-sidebar.tsx`, `*-sidebar.tsx` files

## Remaining Issues

### 1. Dual Storage System (Not Unified)
**Impact:** High - Data can exist in one system but not the other
**Current State:**
- Triage → Database (entities, facts with embeddings)
- Granola → Database (with daily note summary)
- Chat → Daily notes only
- Heartbeat → File system only (life/ directory)

**Problem:**
- Search in DB misses file-system-only entities
- QMD search misses DB-only entities
- Entity can exist in both with different facts

### 2. Heartbeat Doesn't Sync to Database
**Impact:** Medium - Entities extracted from daily notes aren't searchable via DB
**Current:** Heartbeat creates file system entities but doesn't touch database
**Should:** Either sync to DB after extraction, or use single storage

### 3. Pattern Matching Fallback Is Basic
**Impact:** Low (Ollama usually available) - But when Ollama is down, extraction is minimal
**Current:** Only extracts "First Last" names and "Project X" patterns
**Could:** Add more sophisticated regex patterns, or fail gracefully

### 4. No Conflict Resolution
**Impact:** Medium - If same entity edited in both systems, no merge strategy
**Current:** Systems are independent
**Should:** Last-write-wins or manual merge

## Recommendations

### Short-term (Next 1-2 sessions)

1. **Add heartbeat → database sync**
   - After extracting entities to file system, also upsert to database
   - Ensures all entities are searchable via both mechanisms
   - ~2-3 hours work

2. **Unify search interface**
   - Create a single search function that queries both QMD and database
   - Deduplicate and merge results
   - ~2-3 hours work

### Medium-term (Next few weeks)

3. **Choose primary storage**
   - Decide: Is database or file system the source of truth?
   - Recommended: **Database primary, file system for summaries/archives**
   - This simplifies sync logic and leverages semantic search

4. **Add edit audit trail**
   - Track when entities/facts are modified and by whom
   - Enables conflict detection and resolution

### Long-term (Architecture)

5. **Consider unified event log**
   - All writes go through an event log first
   - Both systems consume from the log
   - Ensures consistency, enables replay

## Configuration Summary

After this session, the following are configurable:

```bash
# Heartbeat
HEARTBEAT_INTERVAL_MINUTES=15    # Default: 15
HEARTBEAT_ENABLED=true           # Default: true

# Synthesis
SYNTHESIS_HOUR=3                 # Default: 3 (3 AM)
SYNTHESIS_ENABLED=true           # Default: true

# Timezone
USER_TIMEZONE=America/Los_Angeles # Default: America/Los_Angeles

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
```

## Files Changed This Session

```
src/lib/memory/search.ts          # Search result cleaning
src/lib/memory/extraction.ts      # Ollama semantic extraction
src/lib/scheduler.ts              # Synthesis scheduling
src/instrumentation.ts            # Start all schedulers
src/app/api/heartbeat/status/     # Synthesis status endpoint
src/app/api/triage/[id]/memory/   # Better triage notes
docs/systems/heartbeat.md         # Synthesis documentation
src/components/aurelius/*sidebar* # Sidebar refactoring
```

## Testing Checklist

- [ ] Search for "wasserman" - should show clean content, not diff markers
- [ ] Save triage item to memory - should show facts in daily notes
- [ ] Chat with memorable content - should extract semantically (if Ollama running)
- [ ] Check `/api/heartbeat/status` - should show synthesis scheduler running
- [ ] Wait for 3 AM (or trigger manually) - synthesis should run

## Next Steps

1. Monitor the system for a few days to ensure scheduling is stable
2. Prioritize the "heartbeat → database sync" improvement
3. Consider merging feature branch to main once stable
