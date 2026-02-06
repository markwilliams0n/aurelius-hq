# Supermemory Transition

This document covers the migration from the original QMD/Ollama memory system to Supermemory, including how to revert if needed.

## What Changed

### Before (QMD + Ollama extraction)

The original memory system used three local components:

1. **QMD (Quick Markdown Database)** — Local CLI tool for semantic search over markdown files in `life/` directory. Used `qmd search` with hybrid retrieval (keyword + vector).
2. **Ollama entity extraction** — Local LLM extracted entities, facts, and relationships from conversations during heartbeat. Stored in PostgreSQL with pgvector embeddings.
3. **Synthesis** — Periodic background job that ran Ollama over accumulated facts to produce summaries and insights.

```
Conversation → Daily Notes → Heartbeat picks up → Ollama extracts entities/facts → DB
                                                 → QMD indexes markdown files
User query → QMD search + DB vector search → Context for AI
```

**Problems:**
- Entity extraction was slow and unreliable (Ollama 3B model hallucinated)
- QMD required `life/` directory with manually curated markdown files
- Synthesis was expensive and produced inconsistent results
- No knowledge graph or automatic fact deduplication

### After (Supermemory)

Supermemory replaces all three components with a single cloud API:

1. **`addMemory()`** — Sends content for automatic extraction, knowledge graph building, and indexing
2. **`getMemoryContext()`** — Returns profile facts (static) + context-relevant memories (dynamic)
3. **`searchMemories()`** — Direct document search with hybrid retrieval + reranking

```
Conversation → Daily Notes + addMemory() (fire-and-forget)
Triage save  → Daily Notes + addMemory() (summary or full mode)
User query   → getMemoryContext() → Context for AI
```

**What Supermemory handles that we used to do locally:**
- Entity extraction (people, companies, projects)
- Fact deduplication and knowledge graph maintenance
- Semantic search with hybrid retrieval + reranking
- User profile building (static facts)

### What Ollama still does

Ollama is still used for:
- **Triage summarization** — Summarizes long content (Granola transcripts, emails) before sending to Supermemory to save tokens
- **Triage enrichment** — Generates summaries, priorities, tags for inbox items

Ollama is **no longer** used for:
- Entity extraction from conversations
- Fact generation
- Synthesis

## Revert Guide

### Quick revert to pre-Supermemory

The last commit on `main` before the Supermemory branch:

```
b3564e6 feat: memory debug mode, Ollama-powered enrichment, and chat memory fixes
```

To revert:

```bash
git checkout main
git reset --hard b3564e6
```

This restores the full QMD + Ollama extraction system. You'll need:
- `life/` directory with markdown files for QMD search
- `qmd` CLI installed and available on PATH
- Ollama running locally for entity extraction
- The synthesis scheduler will resume on next `bun run dev`

### Branch reference

All Supermemory work is on `feature/explore-supermemory`. Key commits in order:

| Commit | Description |
|--------|-------------|
| `cb60a5c` | docs: memory service research and Supermemory integration plan |
| `649d582` | feat: replace QMD search with Supermemory for chat context |
| `8d99f70` | feat: feed chat conversations to Supermemory |
| `ecc01df` | feat: feed triage saves to Supermemory |
| `742e0d5` | feat: simplify heartbeat — remove extraction and QMD steps |
| `75f282c` | feat: update memory search API and triage enrichment to use Supermemory |
| `feb79da` | chore: remove dead QMD/synthesis code and obsolete test scripts |
| `217fb49` | feat: add seed script for migrating life/ entities to Supermemory |
| `1445700` | docs: update architecture and memory docs for Supermemory integration |
| `17685d3` | feat: triage memory modes — summary and full |

### Files removed during migration

These files were deleted as part of the cleanup (`feb79da`):

- `src/lib/memory/access-tracking.ts` — QMD search access tracking
- `src/lib/memory/entity-resolution.ts` — Ollama entity extraction
- `src/lib/memory/evaluator.ts` — Fact evaluation/scoring
- `src/lib/memory/synthesis.ts` — Periodic synthesis job
- `src/app/api/synthesis/route.ts` — Synthesis API endpoint
- `scripts/synthesis.ts` — Manual synthesis trigger
- `scripts/test-heartbeat.ts` — Heartbeat test script
- `scripts/test-heartbeat-scenarios.ts` — Heartbeat scenario tests

### Files added

- `src/lib/memory/supermemory.ts` — Supermemory client (`addMemory`, `getMemoryContext`, `searchMemories`)
- `scripts/seed-supermemory.ts` — Migration script to seed `life/` entities into Supermemory

### Files significantly modified

- `src/lib/memory/search.ts` — Removed ~250 lines of QMD search code. Now just `buildMemoryContext()` and `getAllMemory()`, backed by Supermemory.
- `src/lib/memory/heartbeat.ts` — Removed entity extraction and QMD indexing steps. Now connector-sync only.
- `src/lib/memory/extraction.ts` — Rewritten to send content to Supermemory instead of local extraction pipeline.
- `src/app/api/triage/[id]/memory/route.ts` — Added summary/full mode with Ollama summarization.

## Environment

### Required

```bash
SUPERMEMORY_API_KEY=...   # Get from supermemory.com dashboard
```

### Optional (for triage summarization)

```bash
OLLAMA_URL=http://localhost:11434   # Default
OLLAMA_MODEL=llama3.2:3b            # Default
```

## Token Usage

Supermemory's free tier includes 1M tokens. To manage usage:

- **Triage saves**: Use ↑ (summary mode) for long content like Granola transcripts. Ollama summarizes locally first, reducing ~5K tokens to ~200.
- **Chat extraction**: Fires automatically for notable conversations. Content is sent as-is (no summarization step).
- **Seed script**: One-time cost. The 10 `life/` entities used minimal tokens.

Monitor usage at [supermemory.com](https://supermemory.com).
