# Memory V2 Implementation Guide

## Overview

Memory V2 is a comprehensive knowledge management system for Aurelius that combines structured entity storage, intelligent extraction, and temporal decay to create a persistent, evolving memory layer. The system uses a local LLM (Ollama) for entity extraction and maintains a PARA-method organized knowledge base.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chat Interface                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Chat Client  │  │ Memory       │  │ Thinking Waves        │  │
│  │ (messages)   │  │ Sidebar      │  │ (AI status animation) │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ /api/chat    │  │ /api/memory  │  │ /api/heartbeat│          │
│  │ (streaming)  │  │ (browse/     │  │ /api/synthesis│          │
│  │              │  │  search)     │  │               │          │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Memory System                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Heartbeat    │  │ Synthesis    │  │ Access       │           │
│  │ (extraction) │  │ (decay)      │  │ Tracking     │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Ollama LLM   │  │ QMD Search   │  │ Daily Notes  │           │
│  │ (local AI)   │  │ (hybrid)     │  │ (journal)    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    File System Storage                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ life/                    (PARA knowledge base)            │   │
│  │   projects/              - Active projects                │   │
│  │   areas/                 - Ongoing responsibilities       │   │
│  │     people/              - Person entities                │   │
│  │     companies/           - Company entities               │   │
│  │   resources/             - Reference materials            │   │
│  │   archives/              - Inactive items                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ memory/                  (Daily notes/journal)            │   │
│  │   2026-02-01.md          - Date-based entries             │   │
│  │   ...                                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Heartbeat System (`src/lib/memory/heartbeat.ts`)

The heartbeat process scans recent daily notes and extracts entities using Ollama LLM.

**Process Flow:**
1. Scan last 3 daily notes from `memory/` directory
2. For each note, extract entities using Ollama (or pattern matching fallback)
3. Create new entity directories in `life/` structure
4. Add facts to existing entities (with duplicate detection)
5. Reindex QMD search

**Usage:**
```bash
# CLI - run once
npx tsx scripts/heartbeat.ts

# CLI - watch mode (every 5 minutes)
npx tsx scripts/heartbeat.ts --watch

# API endpoint
curl -X POST http://localhost:3000/api/heartbeat
```

**Entity Structure:**
```
life/areas/people/john-smith/
  ├── summary.md       # Entity overview
  └── items.json       # Facts array with metadata
```

### 2. Ollama Integration (`src/lib/memory/ollama.ts`)

Local LLM client for intelligent entity extraction without cloud dependencies.

**Features:**
- Automatic availability detection
- Configurable model (default: `llama3.2:3b`)
- Robust JSON parsing with error recovery
- Temperature-controlled generation

**Configuration:**
```bash
# Environment variables
OLLAMA_URL=http://localhost:11434  # Ollama server
OLLAMA_MODEL=llama3.2:3b           # Model to use
```

**Setup:**
```bash
# Install Ollama
brew install ollama

# Pull model
ollama pull llama3.2:3b

# Start service
brew services start ollama
```

### 3. Memory Decay & Synthesis (`src/lib/memory/synthesis.ts`)

Weekly synthesis process that manages memory freshness and archives cold facts.

**Decay Tiers:**
| Tier | Age | Access | Behavior |
|------|-----|--------|----------|
| Hot | <7 days | - | Always retrieved |
| Warm | 8-30 days | <10 accesses | Deprioritized |
| Cold | >30 days | <5 accesses | Archived |

**Synthesis Process:**
1. Calculate decay tier for each fact
2. Archive cold facts (move to `_archived.json`)
3. Regenerate entity summaries using LLM
4. Return processing statistics

**Usage:**
```bash
# CLI
npx tsx scripts/synthesis.ts

# API endpoint
curl -X POST http://localhost:3000/api/synthesis

# Recommended cron (Sunday midnight)
0 0 * * 0 cd /path/to/aurelius-hq && npx tsx scripts/synthesis.ts
```

### 4. Access Tracking (`src/lib/memory/access-tracking.ts`)

Tracks entity access patterns for intelligent decay calculations.

**Tracked Metrics:**
- `lastAccessed`: Timestamp of most recent access
- `accessCount`: Total number of accesses
- Per-fact access statistics

**Integration:**
Access is automatically recorded when:
- Entities are retrieved during search
- Memory context is built for chat
- Entity details are viewed in UI

### 5. Search System (`src/lib/memory/search.ts`)

Hybrid search combining keyword, semantic, and LLM reranking.

**Search Types:**
- `hybrid`: Combined BM25 + vector + LLM reranking (default)
- `keyword`: BM25 text matching
- `semantic`: Vector similarity search

**API:**
```typescript
// Build context for chat
const context = await buildMemoryContext(query, limit);

// Direct search
const results = await searchMemory(query, type, limit);
```

### 6. Memory Browser UI (`src/components/aurelius/memory-browser.tsx`)

Visual interface for exploring the knowledge base.

**Tabs:**
- **Browse**: PARA structure navigation with entity counts
- **Daily Notes**: Chronological journal entries
- **Search Results**: QMD-powered search

**API Endpoints:**
- `GET /api/memory` - Overview with entity counts
- `GET /api/memory/browse/:path` - File/directory listing
- `GET /api/memory/search?q=...&type=...` - Search

### 7. Memory Sidebar (`src/components/aurelius/memory-sidebar.tsx`)

Collapsible sidebar for chat interface with memory controls.

**Features:**
- Recent entities with fact counts
- Heartbeat trigger with results
- Synthesis trigger with statistics
- Extraction method indicator (LLM/Pattern)
- Entity detail expansion

### 8. Thinking Waves (`src/components/aurelius/thinking-waves.tsx`)

Canvas-based animation displayed when AI is processing.

**Characteristics:**
- Multi-colored wave lines (gold primary)
- Full-width canvas rendering
- Smooth sine-wave animation
- Optional glow effects on primary wave

## File Structure

```
src/lib/memory/
├── access-tracking.ts   # Entity access tracking
├── daily-notes.ts       # Daily note operations
├── extraction.ts        # Entity extraction utilities
├── facts.ts             # Fact management
├── heartbeat.ts         # Heartbeat process
├── ollama.ts            # Ollama LLM client
├── search.ts            # QMD search integration
└── synthesis.ts         # Memory decay & synthesis

src/app/api/
├── chat/route.ts        # Streaming chat with memory
├── heartbeat/route.ts   # Trigger heartbeat
├── synthesis/route.ts   # Trigger synthesis
└── memory/
    ├── route.ts         # Memory overview
    ├── browse/[...path]/route.ts  # File browser
    └── search/route.ts  # Memory search

src/components/aurelius/
├── chat-client.tsx      # Chat interface
├── chat-message.tsx     # Message rendering
├── chat-status.tsx      # Connection status
├── memory-browser.tsx   # Knowledge browser
├── memory-sidebar.tsx   # Chat sidebar
├── thinking-waves.tsx   # AI status animation
├── aurelius-avatar.tsx  # AI avatar
└── user-avatar.tsx      # User avatar

scripts/
├── heartbeat.ts         # Heartbeat CLI
└── synthesis.ts         # Synthesis CLI
```

## Data Formats

### Entity Fact (`items.json`)

```json
{
  "id": "john-smith-1706745600000",
  "fact": "Works at Acme Corp as Senior Engineer",
  "category": "context",
  "timestamp": "2026-02-01",
  "source": "memory/2026-02-01.md",
  "status": "active",
  "supersededBy": null,
  "relatedEntities": ["acme-corp"],
  "lastAccessed": "2026-02-01T12:00:00.000Z",
  "accessCount": 5
}
```

### Entity Summary (`summary.md`)

```markdown
# John Smith

**Type:** person
**Created:** 2026-02-01

## Summary

John Smith is a Senior Engineer at Acme Corp, based in Austin.
He has been working on the ROSTR project since January 2026.
```

### Daily Note (`memory/YYYY-MM-DD.md`)

```markdown
# February 1, 2026

## Notes

Met with John Smith about the ROSTR project. He mentioned that
Acme Corp is expanding their Austin office.

## Tasks

- [ ] Follow up with John about API integration
- [x] Review ROSTR architecture docs
```

## Configuration

### Environment Variables

```bash
# Ollama Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# QMD Configuration (if using)
QMD_PATH=/path/to/qmd
```

### Memory Paths

The system uses these paths relative to project root:
- `life/` - PARA knowledge base
- `memory/` - Daily notes

## Best Practices

### Daily Notes

1. Write conversational entries about people, projects, companies
2. Include specific facts and context
3. Use consistent naming for entities
4. Add date context for time-sensitive information

### Entity Management

1. Let heartbeat create entities automatically
2. Review and edit summaries periodically
3. Run synthesis weekly to archive cold facts
4. Check extraction results for misclassifications

### Performance

1. Keep Ollama running for faster extraction
2. Limit daily note content to 4000 chars (truncated for LLM)
3. Run synthesis during low-usage periods
4. Index QMD regularly for search accuracy

## Troubleshooting

### Ollama Not Available

```bash
# Check if running
curl http://localhost:11434/api/tags

# Start service
brew services start ollama

# Check logs
brew services info ollama
```

### JSON Parsing Errors

The system includes robust JSON recovery for malformed LLM output:
- Trailing comma removal
- Control character cleaning
- Regex-based entity extraction fallback

### Empty Extraction

If heartbeat extracts no entities:
1. Check daily note content is meaningful
2. Verify Ollama is running and responding
3. Review the extraction prompt in `ollama.ts`
4. Check for pattern matching fallback logs

## Next Steps & Suggestions

### Short-term Improvements

1. **Entity Merging**: Add UI to merge duplicate entities (e.g., "John" and "John Smith")
2. **Location Entity Type**: Add support for cities/locations as a fourth entity type
3. **Relationship Graphing**: Visualize entity relationships as a network graph
4. **Search Filters**: Add date range and entity type filters to search
5. **Bulk Import**: CLI tool to import existing notes/documents

### Medium-term Enhancements

1. **Multi-modal Memory**: Support images and documents in daily notes
2. **Collaborative Memory**: Share entities between Aurelius instances
3. **Memory API**: REST API for external integrations
4. **Smart Notifications**: Alert when entities haven't been accessed
5. **Entity Templates**: Pre-defined schemas for common entity types

### Long-term Vision

1. **Federated Knowledge**: Sync memory across devices
2. **AI Summarization**: Weekly/monthly knowledge digests
3. **Predictive Recall**: Surface relevant memories proactively
4. **Voice Integration**: Dictate daily notes and queries
5. **Plugin System**: Custom extractors for specialized domains

## API Reference

### GET /api/memory

Returns memory overview with entity counts.

```json
{
  "projects": 5,
  "people": 23,
  "companies": 12,
  "resources": 8,
  "dailyNotes": 45,
  "lastHeartbeat": "2026-02-01T12:00:00Z"
}
```

### GET /api/memory/browse/:path

Browse PARA structure. Returns files and directories.

```json
{
  "path": "areas/people",
  "items": [
    { "name": "john-smith", "type": "directory", "modifiedAt": "..." },
    { "name": "jane-doe", "type": "directory", "modifiedAt": "..." }
  ]
}
```

### GET /api/memory/search

Search memory with QMD.

**Query Parameters:**
- `q`: Search query (required)
- `type`: Search type - `hybrid`, `keyword`, `semantic` (default: `hybrid`)
- `limit`: Max results (default: 10)

```json
{
  "results": [
    {
      "path": "life/areas/people/john-smith/items.json",
      "score": 0.85,
      "snippet": "Works at Acme Corp..."
    }
  ],
  "query": "John Smith Acme",
  "type": "hybrid"
}
```

### POST /api/heartbeat

Trigger heartbeat process.

```json
{
  "success": true,
  "entitiesCreated": 5,
  "entitiesUpdated": 12,
  "reindexed": true,
  "extractionMethod": "ollama",
  "entities": [...]
}
```

### POST /api/synthesis

Trigger weekly synthesis.

```json
{
  "success": true,
  "entitiesProcessed": 35,
  "factsArchived": 8,
  "summariesRegenerated": 3,
  "errors": []
}
```

---

*Last updated: February 2026*
*Memory V2 Implementation - Aurelius AI*
