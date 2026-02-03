# Memory System

The memory system gives Aurelius persistent knowledge across conversations. It uses a hybrid architecture combining file-based storage, database records, and vector search.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY LAYERS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SHORT-TERM                    LONG-TERM                         │
│  ───────────                   ─────────                         │
│                                                                  │
│  Daily Notes (memory/)         Structured Entities (life/)       │
│  • Last 24 hours direct        • People, companies, projects     │
│  • Timestamped entries         • Facts with categories           │
│  • Conversation snippets       • Searchable via QMD              │
│                                                                  │
│          ↓ Heartbeat extracts entities ↓                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        SEARCH LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  QMD Hybrid Search                                               │
│  • BM25 keyword matching                                         │
│  • Vector semantic search                                        │
│  • Neural reranking                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Layers

### 1. Daily Notes (Short-Term)

**Location:** `memory/YYYY-MM-DD.md`

The most recent memory layer. Conversations and events are logged here as they happen.

**How it's used:**
- Last 24 hours included directly in chat context (no search needed)
- Older notes searchable via QMD after heartbeat indexes them

**See:** [Daily Notes](./daily-notes.md)

### 2. Structured Entities (Long-Term)

**Location:** `life/` directory

```
life/
├── areas/
│   ├── people/           # John Smith, Jane Doe
│   │   └── {slug}/
│   │       ├── summary.md
│   │       └── items.json
│   └── companies/        # Acme Corp, StubHub
├── projects/             # Project Alpha, Website Redesign
└── resources/            # Reference materials
```

Each entity has:
- `summary.md` - Overview and metadata
- `items.json` - Facts with timestamps, sources, access tracking

**How it's created:**
- Heartbeat extracts entities from daily notes (with smart resolution)
- Granola sync extracts from meeting transcripts
- Manual creation via API or file editing

**See:** [Entity Resolution](./entity-resolution.md) for how names like "Adam" get matched to "Adam Watson"

### 3. Database Records

**Location:** PostgreSQL + pgvector

```
entities          - People, projects, topics (with embeddings)
facts             - Atomic facts linked to entities
documents         - Ingested content
document_chunks   - Chunked + embedded pieces
```

Used primarily by:
- Granola sync (stores extracted memory with embeddings)
- Document ingestion pipeline
- Direct API access

## Data Flow

### Writing Memory

```
Conversation
    ↓
containsMemorableContent()?
    ↓ yes
appendToDailyNote()
    ↓
memory/YYYY-MM-DD.md
    ↓ (heartbeat, every 15min)
extractEntitiesWithLLM()
    ↓
life/areas/people/{name}/
```

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
│ (QMD search on life/)       │    (query-based)
└─────────────────────────────┘
    ↓
System Prompt → AI Response
```

## Search

### QMD Collections

| Collection | Content | Use Case |
|------------|---------|----------|
| `life` | Structured entities | Long-term knowledge |
| `memory` | Daily notes | Historical search |
| `me` | Personal profile | Self-reference |

### Search Types

| Type | Speed | Best For |
|------|-------|----------|
| Keyword (BM25) | ~0.2s | Exact name/term matches |
| Semantic (vector) | ~3s | Conceptual similarity |
| Hybrid | ~6s | Best results (default) |

## Background Processing

### Heartbeat

Runs every 15 minutes to process new content:

1. Extract entities from daily notes
2. Sync Granola meetings
3. Reindex QMD search

**See:** [Heartbeat](./heartbeat.md)

### Synthesis (Future)

Planned periodic process to:
- Consolidate duplicate facts
- Update entity summaries
- Archive stale information

## Configuration

### Environment Variables

```bash
# Entity extraction
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# Embeddings (for database records)
OPENAI_API_KEY=...
```

### Heartbeat Scheduling

```bash
HEARTBEAT_INTERVAL_MINUTES=15   # Default
HEARTBEAT_ENABLED=true          # Disable with 'false'
```

## File Locations

| Component | Path |
|-----------|------|
| Daily notes | `memory/*.md` |
| Entity files | `life/` |
| Search module | `src/lib/memory/search.ts` |
| Daily notes module | `src/lib/memory/daily-notes.ts` |
| Heartbeat | `src/lib/memory/heartbeat.ts` |
| Activity log | `life/system/activity-log.json` |

## Related Documentation

- [Daily Notes](./daily-notes.md) - Short-term memory layer
- [Heartbeat](./heartbeat.md) - Background processing
- [Entity Resolution](./entity-resolution.md) - Smart matching of extracted names
- [Triage](./triage.md) - Inbox system that feeds memory
- [Architecture](../../ARCHITECTURE.md) - System overview
