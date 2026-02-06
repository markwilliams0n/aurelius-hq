# Memory System

The memory system gives Aurelius persistent knowledge across conversations. It uses a two-layer architecture: short-term daily notes (local files) and long-term memory via Supermemory (cloud API).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY LAYERS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SHORT-TERM                    LONG-TERM                        │
│  ───────────                   ─────────                        │
│                                                                 │
│  Daily Notes (memory/)         Supermemory (cloud API)          │
│  • Last 24 hours direct        • Knowledge graph                │
│  • Timestamped entries         • Profile facts (static)         │
│  • Conversation snippets       • Context-relevant memories      │
│                                                                 │
│  Chat messages and triage saves feed both layers directly       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Layers

### 1. Daily Notes (Short-Term)

**Location:** `memory/YYYY-MM-DD.md`

The most recent memory layer. Conversations and events are logged here as they happen.

**How it's used:**
- Last 24 hours included directly in chat context (no search needed)
- Provides immediate conversation context

**See:** [Daily Notes](./daily-notes.md)

### 2. Supermemory (Long-Term)

**Backend:** [Supermemory](https://supermemory.com) cloud API

All content is sent to Supermemory for automatic extraction, knowledge graph building, and semantic search.

**How it's used:**
- `addMemory(content, metadata)` — sends content for extraction + indexing
- `getMemoryContext(query)` — returns profile facts + relevant memories
- `searchMemories(query, limit)` — direct document search

**What Supermemory handles:**
- Entity extraction (people, companies, projects)
- Fact deduplication and knowledge graph maintenance
- Semantic search with hybrid retrieval + reranking
- User profile building (static facts about the user)

### 3. Database Records

**Location:** PostgreSQL + pgvector

```
entities          - People, projects, topics, companies
facts             - Atomic facts linked to entities
documents         - Ingested content
document_chunks   - Chunked + embedded pieces
conversations     - Chat history (shared between web + Telegram)
inbox_items       - Triage inbox from connectors
```

## Data Flow

### Writing Memory — Chat

```
Conversation
    ↓
containsMemorableContent()?
    ↓ yes
┌──────────────────────────────────┐
│ appendToDailyNote()              │ → memory/YYYY-MM-DD.md (short-term)
│ addMemory() (fire-and-forget)    │ → Supermemory (long-term)
└──────────────────────────────────┘
```

Chat messages always send full content to both layers.

### Writing Memory — Triage (Summary vs Full)

Triage items support two save modes to control Supermemory token usage:

| Mode | Shortcut | Daily Notes | Supermemory | Use case |
|------|----------|-------------|-------------|----------|
| **Summary** | ↑ | Ollama summary | Ollama summary | Long content (Granola, emails) |
| **Full** | ⇧↑ | Full content | Full content | Short/important content |

```
User presses ↑ (summary) or ⇧↑ (full)
    ↓
POST /api/triage/{id}/memory  { mode: "summary" | "full" }
    ↓
mode == "summary"?
    ├─ yes → Ollama summarizes content (2-4 sentences)
    │        Falls back to full if Ollama unavailable
    └─ no  → Use raw content
    ↓
appendToDailyNote(content)     → memory/YYYY-MM-DD.md
addMemory(content, metadata)   → Supermemory
```

**Why summarize?** Supermemory charges by token. A single Granola meeting transcript can use 5K+ tokens. An Ollama summary brings that down to ~200 tokens while preserving key facts, people, and decisions.

### Reading Memory

```
User Message
    ↓
┌─────────────────────────────┐
│ getRecentNotes()            │ → "## Recent Activity"
│ (last 24h, direct read)     │    (always included)
└─────────────────────────────┘
    ↓
┌─────────────────────────────┐
│ buildMemoryContext()        │ → "## Relevant Memory"
│ (Supermemory profile API)   │    (query-based)
└─────────────────────────────┘
    ↓
System Prompt → AI Response
```

## Background Processing

### Heartbeat

Runs every 15 minutes to sync external connectors (Granola, Gmail, Linear, Slack) into the triage inbox. Memory extraction is **not** part of heartbeat — it happens inline when chat messages or triage saves occur.

**See:** [Heartbeat](./heartbeat.md)

## Configuration

### Environment Variables

```bash
# Supermemory
SUPERMEMORY_API_KEY=...        # Required for long-term memory

# Ollama (local LLM for summarization + enrichment)
OLLAMA_URL=http://localhost:11434  # Default
OLLAMA_MODEL=llama3.2:3b           # Default

# Heartbeat Scheduling
HEARTBEAT_INTERVAL_MINUTES=15  # Default
HEARTBEAT_ENABLED=true         # Disable with 'false'
```

## File Locations

| Component | Path |
|-----------|------|
| Daily notes | `memory/*.md` |
| Supermemory client | `src/lib/memory/supermemory.ts` |
| Context building | `src/lib/memory/search.ts` |
| Daily notes module | `src/lib/memory/daily-notes.ts` |
| Chat extraction | `src/lib/memory/extraction.ts` |
| Triage memory save | `src/app/api/triage/[id]/memory/route.ts` |
| Ollama client | `src/lib/memory/ollama.ts` |
| Heartbeat | `src/lib/memory/heartbeat.ts` |

## Migration History

See [Supermemory Transition](./supermemory-transition.md) for details on the migration from QMD/Ollama extraction to Supermemory, including revert instructions.

## Related Documentation

- [Daily Notes](./daily-notes.md) - Short-term memory layer
- [Heartbeat](./heartbeat.md) - Background connector sync
- [Triage](./triage.md) - Inbox system that feeds memory
- [Supermemory Transition](./supermemory-transition.md) - Migration details + revert guide
- [Architecture](../../ARCHITECTURE.md) - System overview
