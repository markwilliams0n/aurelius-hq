# Aurelius Memory Architecture Discussion

**Date:** 2026-02-01
**Status:** Decisions complete - see implementation plan
**Implementation:** [Memory V2 Implementation Plan](plans/2026-02-01-memory-v2-implementation.md)

## The Goal

Build a personal AI assistant that helps triage and organize life. AI-first interface, but with browsable structure underneath.

## What We Built Initially

- PostgreSQL database with `entities` and `facts` tables
- Vector embeddings (pgvector) for semantic search
- Real-time `remember()` tool that the AI calls to save facts
- Chat interface with streaming
- Memory browser page

## The Problem We Hit

The `remember()` tool was unreliable:
- Model (kimi-k2) inconsistently called the tool
- When it did call it, entity names were often wrong (punctuation, partial words)
- Required increasingly aggressive prompting
- Still unreliable even with strong prompts

## Research: How Others Solve This

### OpenClaw / Clawdbot Approach

Read their documentation and a detailed blog post. Key insights:

**1. Memory is plain Markdown files, not a database**
```
~/workspace/
├── MEMORY.md              # Long-term curated knowledge
├── memory/
│   ├── 2026-02-01.md      # Daily notes (append-only)
│   └── 2026-02-02.md
```

**2. No dedicated memory_write tool**
> "There is no dedicated memory_write tool. The agent writes to memory using the standard write and edit tools."

This is the key insight. File writes always work. No tool-calling reliability issues.

**3. Two-layer memory system**
- **Daily notes** (`memory/YYYY-MM-DD.md`): Raw timeline, append-only, what happened when
- **Long-term memory** (`MEMORY.md`): Curated, significant decisions/preferences

**4. Background extraction (heartbeat)**
Instead of real-time tool calling:
- Agent writes to daily notes during conversation
- Background process periodically extracts durable facts
- Writes structured data to knowledge graph

**5. Hybrid search (BM25 + Vector)**
- Vector search: Good at semantic similarity
- BM25 (keyword): Good at exact tokens (names, IDs, code)
- Combined: `finalScore = 0.7 * vectorScore + 0.3 * textScore`

**6. Memory decay**
- Track `lastAccessed` and `accessCount` for each fact
- Tiers: Hot (7 days), Warm (8-30 days), Cold (30+ days)
- Cold facts omitted from summaries but still searchable
- High access count resists decay

**7. Tiered retrieval**
- `summary.md` loaded first (quick context)
- Full facts loaded only when needed
- Keeps context windows lean

### PARA Framework Integration

From the "Agentic PKM" article:

```
life/
├── projects/          # Active work with deadlines
├── areas/             # Ongoing responsibilities (people, companies)
├── resources/         # Reference material
└── archives/          # Inactive items
```

Each entity gets:
- `summary.md` - Quick context
- `items.json` - Atomic facts with schema

Atomic fact schema:
```json
{
  "id": "entity-001",
  "fact": "Joined as CTO in March 2025",
  "category": "milestone",
  "timestamp": "2025-03-15",
  "status": "active",
  "supersededBy": null,
  "relatedEntities": ["companies/acme"],
  "lastAccessed": "2026-01-28",
  "accessCount": 12
}
```

**No-deletion rule**: Facts are superseded, not deleted. Full history preserved.

## The Architectural Decision

**Hybrid: Files for knowledge, Postgres for transactions.**

The system has two types of data with different characteristics:

| **Transactional Data** (Postgres) | **Knowledge Data** (Files + QMD) |
|-----------------------------------|----------------------------------|
| Sessions, auth | Entities (people, projects, companies) |
| Inbox items | Facts about entities |
| Tasks | Daily notes (timeline) |
| Connectors | Tacit knowledge (ME.md) |
| Activity log | |
| Triage rules | |
| Conversations | |

**Why this split:**

Transactional data needs:
- Foreign key relationships
- Status updates and queries
- ACID guarantees
- Integration with triage/task UIs

Knowledge data benefits from files:
- No special tools needed (AI knows read/write)
- Always works (no tool-calling reliability)
- Transparent (human readable, git-friendly)
- Portable (works with any AI)
- Natural (AI thinks in text)

**QMD as the search layer:**

Instead of building our own search, use [QMD](https://github.com/tobi/qmd):
- TypeScript/Bun (same ecosystem)
- SQLite FTS5 for BM25 keyword search
- Vector embeddings for semantic search
- LLM-powered re-ranking
- MCP integration for Claude
- Collections for organizing different memory layers

## Proposed Architecture

### Hybrid Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                        Aurelius                              │
├─────────────────────────────────────────────────────────────┤
│  Postgres (Neon)              │  Files + QMD                │
│  ─────────────────            │  ────────────                │
│  • users, sessions            │  • life/ (PARA)              │
│  • inbox_items                │    ├── people/               │
│  • tasks                      │    ├── projects/             │
│  • connectors                 │    ├── companies/            │
│  • triage_rules               │    └── ...                   │
│  • activity_log               │  • memory/ (daily notes)     │
│  • conversations              │  • ME.md (tacit knowledge)   │
│                               │                              │
│  Queries, status, FKs         │  Knowledge graph             │
│  ↓                            │  ↓                           │
│  Triage UI, Tasks UI          │  QMD index → AI context      │
└─────────────────────────────────────────────────────────────┘
```

### File Structure (Knowledge Layer)

Location: `./life/` directory within the app (for now - can move to `~/aurelius/` later)

```
life/
├── projects/              # Active work with deadlines
│   ├── aurelius/
│   │   ├── summary.md
│   │   └── items.json
│   └── _index.md
├── areas/                 # Ongoing responsibilities
│   ├── people/
│   │   ├── joe-bloggs/
│   │   │   ├── summary.md
│   │   │   └── items.json
│   │   └── sarah/
│   ├── companies/
│   │   └── acme/
│   └── _index.md
├── resources/             # Reference material
│   └── _index.md
├── archives/              # Inactive items
│   └── _index.md
└── _index.md

memory/
├── 2026-02-01.md          # Daily notes (timeline)
├── 2026-02-02.md
└── ...

ME.md                      # Tacit knowledge (preferences, patterns)
```

### Entity File Format (e.g., `people/joe-bloggs.md`)

```markdown
# Joe Bloggs

**Type:** Person
**Category:** Area
**Last Updated:** 2026-02-01

## Summary

Friend who lives in Los Angeles. Works in tech.

## Facts

- Lives in Los Angeles (2026-02-01)
- Works at TechCorp as engineer (2026-01-15)

## Relationships

- [[companies/techcorp]] - Employer
- [[people/sarah]] - Mutual friend

## Notes

Met through Sarah at the conference in 2025.
```

### AI Interaction Model

1. **Reading context**: AI reads relevant files before responding
2. **Writing memories**: AI appends to daily notes or edits entity files
3. **Searching**: AI uses search tool that queries the SQLite index
4. **No special memory tools**: Just standard file operations

### Background Processes

1. **Index sync**: Watch files, rebuild search index on changes
2. **Extraction** (optional): Periodically scan daily notes, extract to entity files
3. **Weekly synthesis**: Rebuild summaries based on access patterns

### What the Database Stores

- Search index (vectors + BM25) - derived from files
- User sessions / auth
- Conversation history (or could also be files)
- Access metadata for decay

## UI Views

**Primary:** AI chat interface

**Secondary (browsable):**
- `/memory` - Overview with counts by type
- `/memory/people` - All people
- `/memory/projects` - All projects (active vs archived)
- `/memory/timeline` - Daily notes chronologically
- `/memory/search` - Search interface

## Implementation Plan

### Phase 1: File Structure & QMD Setup
- [ ] Create `life/` directory with PARA structure
- [ ] Create `memory/` directory for daily notes
- [ ] Create `ME.md` for tacit knowledge
- [ ] Install QMD (`bun install -g github:tobi/qmd`)
- [ ] Configure QMD collections (life, memory)
- [ ] Test QMD search works

### Phase 2: AI File Writing
- [ ] Update system prompt for file-based memory
- [ ] Implement daily note appending (AI writes to `memory/YYYY-MM-DD.md`)
- [ ] Test AI writing during chat
- [ ] Remove dependency on `remember()` tool
- [ ] Deprecate `entities` and `facts` tables

### Phase 3: Entity Management
- [ ] Entity file templates (`summary.md` + `items.json`)
- [ ] AI can create/update entity files
- [ ] PARA categorization logic
- [ ] Relationship linking via `relatedEntities`

### Phase 4: Memory Browser UI
- [ ] Update `/memory` to read from files
- [ ] Browse by PARA category
- [ ] View entity details
- [ ] Search via QMD

### Phase 5: Intelligence (Heartbeat)
- [ ] Heartbeat process for extraction
- [ ] Extract durable facts from daily notes → entity files
- [ ] Access tracking (`lastAccessed`, `accessCount`)
- [ ] Memory decay tiers (hot/warm/cold)
- [ ] Weekly summary synthesis

## Key Principles

1. **AI-first, structure underneath** - AI is the primary interface, browse when needed
2. **Files as source of truth** - Transparent, portable, AI-friendly
3. **Search over injection** - Don't load everything, search for relevance
4. **No information loss** - Supersede, don't delete
5. **Graceful degradation** - Multiple fallback layers

## Open Questions (Resolved)

- ✅ **Where should the workspace live?** → `./life/` inside app for now, can move to `~/aurelius/` later
- ✅ **How to handle transition?** → Hybrid approach - keep Postgres for transactional data, migrate knowledge to files
- ✅ **Conversation history?** → Keep in Postgres (conversations table) - it's transactional
- ✅ **Structure vs free-form?** → Follow QMD article: `summary.md` + `items.json` per entity

## Key Decisions from Discussion

### 1. Entity Creation: When does AI create an entity vs log to daily notes?

**Decision:** Everything goes to daily notes first, heartbeat extracts later.

**Reasoning:**
- Simpler for AI - just write naturally, no special judgment calls
- Systematic - background process applies consistent rules
- Matches the article's approach
- Avoids the reliability issues we hit with the `remember()` tool

The heartbeat process scans daily notes and promotes to entities when:
- Mentioned 3+ times
- Has direct relationship to user
- Is a significant project/company

### 2. QMD Integration: How do we use QMD from the Next.js app?

**Decision:** Shell out to QMD CLI (local only for now).

**Options considered:**
- A) Shell out to CLI ← chosen
- B) Import as library
- C) Run as separate service
- D) Build our own search
- E) Use simpler search library
- F) Use Postgres FTS + pgvector

**Reasoning:**
- Everything runs locally, so subprocess overhead is acceptable
- Get full QMD features (hybrid search, LLM reranking)
- Easy to test manually
- Defer remote deployment complexity until needed

### 3. Reindexing: When do we update the QMD index?

**Decision:** Heartbeat-based (periodic, every 2 minutes).

**Reasoning:**
- Matches the article's recommendation
- Batches work with extraction process
- Non-blocking for chat operations
- Heartbeat already doing:
  1. Scan daily notes
  2. Extract entities
  3. Reindex QMD ← added here

### 4. Local vs Remote: Where does the system run?

**Decision:** Everything local for now, figure out remote later.

**Architecture:**
```
localhost
├── Next.js (localhost:3333)
├── QMD (shell out)
├── Files (./life/, ./memory/, ME.md)
└── Postgres (Neon - still cloud for transactional data)
```

**Reasoning:**
- Core interface will be custom web app (where hosted TBD)
- Simplifies development - no tunnels or remote access
- QMD runs natively with full features
- Can add remote access (Tailscale, etc.) when needed

### 5. Local LLM: What should run locally vs cloud?

**Decision:** Local LLM for background ops, cloud for chat.

**Local LLM handles:**
- QMD query expansion
- QMD result reranking
- Heartbeat entity extraction
- Summary generation

**Cloud (OpenRouter) handles:**
- Main chat interface (quality matters most)
- Complex reasoning when explicitly needed

**Reasoning:**
- Keeps costs down
- Most processing stays local
- Chat is the "expensive" path, background is "cheap"
- QMD already uses node-llama-cpp with GGUF models

---

## Why QMD is Special

QMD isn't just a search library - it's a sophisticated retrieval pipeline:

**1. Query Expansion**
Before searching, an LLM rewrites queries to capture related terms.
"Joe's job" → "Joe employment work company role position"

**2. Dual Retrieval**
Searches both indexes in parallel:
- BM25 (keyword) - exact matches, names, IDs
- Vector (semantic) - conceptually related content

**3. Reciprocal Rank Fusion**
Combines results from both searches with position-aware scoring.

**4. LLM Reranking**
Local LLM examines top candidates and reorders by actual relevance.

**5. Confidence-based Blending**
Final results blend based on retrieval confidence.

**Why this matters:**
- Simple FTS misses "works at Google" when searching "employment"
- Simple vector misses "Joe Bloggs" (embeddings fuzzy on proper nouns)
- QMD combines intelligently, then verifies with LLM

---

## The Three Memory Layers (from QMD Article)

| Layer | Purpose | Storage | Update Frequency |
|-------|---------|---------|------------------|
| **Knowledge Graph** | Entities and facts | `life/` (PARA + JSON) | Continuous via heartbeat |
| **Daily Notes** | Raw timeline | `memory/YYYY-MM-DD.md` | Every conversation |
| **Tacit Knowledge** | User patterns | `ME.md` | When new patterns emerge |

Like human memory:
- Knowledge graph = declarative memory (facts you know)
- Daily notes = episodic memory (what happened when)
- Tacit knowledge = procedural memory (how you operate)

---

## References

- OpenClaw documentation on memory
- "How Clawdbot Remembers Everything" blog post
- "Agentic PKM with PARA and QMD" blog post
- [QMD - Query Markup Documents](https://github.com/tobi/qmd) - Local search engine for markdown
- Tiago Forte's PARA method
