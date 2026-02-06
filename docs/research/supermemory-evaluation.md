# Supermemory Evaluation for Aurelius

> Research completed 2026-02-05. Evaluated whether Supermemory (supermemory.ai) would be a better approach to memory in Aurelius.

## TL;DR

**Recommendation: Don't switch to Supermemory.** It's a solid product, but adopting it would conflict with Aurelius' local-first/privacy architecture, create vendor dependency on critical infrastructure, and lose the fine-grained extraction control you've already built. The problems it solves best (search/indexing, extraction) are already handled. The real pain point (dual storage sync) is better solved by consolidating to database-primary, which is already the documented recommendation.

---

## What Supermemory Is

Supermemory is a **cloud-hosted memory API** for AI apps. You send it raw content (text, conversations, files, URLs), it automatically:

1. **Extracts** memories (entities, facts, preferences, episodes)
2. **Builds a knowledge graph** with three relationship types:
   - **Updates** (new info supersedes old, tracks `isLatest`)
   - **Extends** (enriches without replacing)
   - **Derives** (infers new connections from patterns)
3. **Indexes** for hybrid search (semantic + keyword)
4. **Builds user profiles** automatically (static facts + dynamic context)

### API Surface

```typescript
import Supermemory from "supermemory";
const client = new Supermemory(); // reads SUPERMEMORY_API_KEY

// Store memory
await client.add({
  content: "Meeting with Adam about Q3 planning...",
  containerTag: "user_mark",      // isolation key
  metadata: { source: "granola" }
});

// Retrieve context
const context = await client.profile({
  containerTag: "user_mark",
  q: "What did Adam say about Q3?"
});
// Returns: { static: [...], dynamic: [...], results: [...] }

// Search
const results = await client.search.documents({
  q: "Q3 revenue targets",
  containerTag: "user_mark",
  searchMode: "hybrid",
  rerank: true
});
```

### Pricing

| Plan | Price | Tokens Processed | Search Queries |
|------|-------|------------------|----------------|
| Free | $0/mo | 1M | 10K |
| Pro | $19/mo | 3M | 100K |
| Scale | $399/mo | 80M | 20M |

At Aurelius' scale (single user), Pro at $19/mo would be more than enough.

### Built-in Connectors

Gmail, Google Drive, Notion, OneDrive, GitHub, Web Crawler - all with OAuth setup and auto-sync.

---

## Side-by-Side Comparison

| Capability | Aurelius Current | Supermemory |
|------------|------------------|-------------|
| **Storage** | Markdown files + PostgreSQL + pgvector | Cloud API (opaque) |
| **Extraction** | Ollama (local, free, customizable prompts) | Automatic (cloud, black box) |
| **Search** | QMD hybrid: BM25 + vector + rerank (~6s) | Hybrid semantic + keyword (sub-300ms claimed) |
| **Entity Resolution** | Multi-signal scoring (name 50%, context 35%, recency 15%) + LLM tie-breaking | Automatic graph relationships |
| **Knowledge Graph** | Flat entity + facts model | Graph with updates/extends/derives |
| **User Profiles** | Not built (manual system prompt) | Auto-generated static + dynamic |
| **Temporal Awareness** | `supersededBy` chain on facts | Built-in with `isLatest`, auto-forgetting |
| **Privacy** | Fully local (Ollama + files + local DB) | Cloud-hosted (data leaves machine) |
| **Offline** | Works (QMD + file reads) | Requires internet |
| **Cost** | Free (Ollama + QMD + pgvector) | $19/mo minimum for production |
| **Connector Overlap** | Gmail, Granola, Linear, Slack (custom, triage-integrated) | Gmail, Google Drive, Notion, OneDrive, GitHub |
| **Customization** | Full control (prompt engineering, extraction rules, blacklists) | Limited to API parameters |
| **Debug/Transparency** | Full event instrumentation, CMD+D overlay, reasoning fields | Opaque |
| **Human-Readable** | Markdown entity files (git-friendly) | API-only access |

---

## What Supermemory Does Better

### 1. Graph Relationships
The updates/extends/derives model is genuinely more sophisticated than Aurelius' flat entity+facts. When Adam changes jobs, Supermemory automatically handles the temporal chain. Aurelius' `supersededBy` field exists but isn't actively used in retrieval.

### 2. Search Speed
Sub-300ms vs ~6s for QMD hybrid search. Significant UX improvement for chat context loading.

### 3. Zero Infrastructure
No QMD binary, no Ollama server, no pgvector extension. Just an API key.

### 4. Auto User Profiles
The static+dynamic profile concept would be useful for Aurelius' system prompt construction. Currently this is manual.

### 5. Less Code to Maintain
Would eliminate ~3000+ lines across heartbeat.ts, ollama.ts, entity-resolution.ts, search.ts, daily-notes.ts, and the QMD integration.

---

## What Aurelius Does Better

### 1. Privacy (Critical)
Aurelius' long-term vision explicitly includes "Data stays on your machine by default", "Privacy by Design", "Encrypted at rest", "No training on your data". Supermemory sends all memory to their cloud. For a **personal AI chief of staff** that knows about your work relationships, company strategy, and personal conversations, this is a fundamental conflict.

### 2. Extraction Control
The Ollama prompts are highly specialized:
- Analytics emails extract actual numbers ("1,234 clicks, 2.7% CTR") not vague summaries
- Entity extraction has location/term blacklists tuned to your world
- Reasoning fields explain every extraction decision
- Debug evaluator critiques extraction quality

Supermemory's extraction is automatic but opaque. You can't tune it.

### 3. Entity Resolution
The multi-signal scoring (name similarity + context overlap + recency decay) with LLM tie-breaking is genuinely sophisticated. "Adam" correctly resolves to "Adam Watson" based on architecture context. Supermemory likely handles this, but you can't see or tune how.

### 4. Triage Integration
Aurelius' connectors (Gmail, Granola, Linear, Slack) don't just ingest content - they feed the triage system with enrichment, suggested tasks, keyboard-driven workflows, and bi-directional sync (archive in Aurelius → archive in Gmail). Supermemory's connectors just ingest documents.

### 5. Debug & Transparency
The memory debug mode (just built!) gives full visibility into what's being extracted, recalled, and why. Every operation has reasoning. This is rare and valuable for improving memory quality over time.

### 6. Offline Capability
Aurelius works without internet (QMD search, file reads, Ollama if running). Supermemory requires connectivity.

---

## Where Supermemory Would Fit (If Adopted)

If you wanted to adopt it despite the trade-offs, here's where it would slot in:

### Replace Layer: Search + Retrieval
- **Remove:** QMD CLI dependency, `search.ts`, pgvector usage
- **Replace with:** `client.search()` and `client.profile()` in `context.ts`
- **Impact:** Faster search, simpler context building, lose QMD/pgvector setup

### Replace Layer: Extraction + Storage
- **Remove:** `ollama.ts` extraction, `heartbeat.ts` entity extraction steps, `entity-resolution.ts`, `life/` directory
- **Replace with:** `client.add()` calls after chat messages and triage saves
- **Impact:** No more Ollama dependency, no entity files, lose extraction customization

### Keep: Everything Else
- Triage system (connectors, enrichment, keyboard workflow)
- Daily notes (short-term context, rolling 24h)
- Chat flow (streaming, tool loops)
- Config system (soul, personality)
- UI (but simplify memory page)

### Integration Points

```
Chat message → AI response → client.add(conversation)
Triage save → client.add(rawContent + enrichment)
Heartbeat → reduced to connector syncs only (no extraction step)
Context building → client.profile(query) replaces QMD search
```

---

## Why Not To Do This

### 1. Architecture Conflict
Aurelius is **local-first by design**. Memory is the most sensitive data in the system. Moving it to a third-party cloud service contradicts the foundational architecture.

### 2. The Real Problem Is Simpler To Fix
The documented pain point is **dual storage sync** (files vs database). The existing recommendation is: make database primary, use files for summaries/exports. This is a focused refactor, not a platform migration.

### 3. Connector Overlap Creates Confusion
Supermemory has Gmail/Notion connectors. Aurelius has Gmail/Granola/Linear/Slack connectors. Which owns the data flow? Do you use Supermemory's Gmail connector or Aurelius'? The triage system depends on Aurelius' connectors for enrichment and actions.

### 4. You Just Built Debug Mode
The memory debug instrumentation (CMD+D, event logging, reasoning, evaluator) was built specifically to improve memory quality over time. Switching to Supermemory makes all of that work irrelevant.

### 5. Vendor Lock-in on Core Feature
Memory is Aurelius' differentiator. Making it depend on a startup's API means:
- They go down → your memory goes down
- They change pricing → you pay or migrate
- They pivot → you scramble
- They get acquired → data migration

---

## Alternatives Worth Considering

### 1. Database-Primary Refactor (Recommended)
**What:** Make PostgreSQL the single source of truth. Remove file-based entity storage (or reduce to export-only). Use pgvector directly for search instead of QMD.

**Removes:** Dual storage sync problem, QMD dependency
**Keeps:** Ollama extraction, entity resolution, debug mode, privacy, offline
**Effort:** Medium (focused refactor of heartbeat + search)
**Risk:** Low

### 2. Replace QMD with pgvector Search
**What:** Use PostgreSQL's built-in vector similarity search instead of the QMD external binary. Already have pgvector and embeddings in the schema.

**Removes:** QMD CLI dependency, 6s search latency
**Keeps:** Everything else
**Effort:** Low-Medium
**Risk:** Low (pgvector is well-tested)

### 3. Mem0 (Open-Source Memory Layer)
**What:** Open-source memory infrastructure that can be **self-hosted**. Similar concept to Supermemory but you run it.

**Pros:** Graph memory, auto-extraction, no cloud dependency
**Cons:** Another system to run, Python-based, less mature
**Effort:** High (integration + hosting)
**Risk:** Medium

### 4. Keep Current + Execute Planned Improvements
**What:** Fix the known issues without changing architecture:
- Connector-specific extraction prompts (email vs meeting vs slack)
- Unify storage to DB-primary
- Improve entity resolution test coverage
- Add synthesis (consolidation, cleanup)

**Removes:** Known pain points
**Keeps:** All current strengths
**Effort:** Medium (spread across multiple sessions)
**Risk:** Low

---

## Verdict

Supermemory is a well-designed product that solves real problems. For a **multi-tenant SaaS app** building AI features, it would be an excellent choice. But Aurelius is a **single-user, local-first personal assistant** where privacy and control matter more than convenience.

The current memory system is complex but working. The complexity comes from having two storage systems that don't sync - and that's a problem you can solve with a focused refactor (database-primary) without giving up privacy, customization, offline capability, or the debug tooling you just built.

**Bottom line:** Supermemory would make memory "more out of the box" but at the cost of the things that make Aurelius' memory uniquely good. The better path is to simplify what you have.
