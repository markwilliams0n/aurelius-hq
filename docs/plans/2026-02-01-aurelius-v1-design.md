# Aurelius V1 Design

**Date:** 2026-02-01
**Status:** Phase 1 Complete

---

## Overview

Aurelius is a personal AI command center that unifies communications (Gmail, Linear) into a single triage interface, backed by a persistent memory system. An AI agent (powered by Claude Max) enriches items with context, drafts replies, and learns over time.

Core loop: **Ingest → Enrich → Triage → Act → Learn → Remember → Repeat**

---

## Key Decisions

| Area | Decision |
|------|----------|
| AI Provider | Claude Max subscription auth |
| Database | Railway Postgres + pgvector |
| V1 Connectors | Gmail + Linear |
| Auth | Magic link (single user) |
| UI Polish | Designed from the start (stoic dark/gold) |
| Background Jobs | Simple worker with setInterval |
| Config Storage | Database with versioning, seed defaults |
| Autonomy | Auto + undo for memory/rules, approve for configs |
| Agent Visibility | Inline where actions happen |
| Triage Interaction | Arrow keys |
| Initial Seeding | JSON via CLI |
| Build Order | Foundation → Memory + Chat → Triage → Actions |

---

## Tech Stack

- **Frontend:** Next.js 14+ (App Router, TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui (custom dark/gold theme)
- **Database:** Drizzle ORM + Railway Postgres + pgvector
- **AI:** Claude Max (Sonnet for reasoning, Haiku for classification)
- **Auth:** Magic link (single user)
- **Hosting:** Railway (app + postgres + worker)

---

## Project Structure

```
aurelius-hq/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # Login, magic link verify
│   │   ├── (app)/              # Authenticated routes
│   │   │   ├── triage/         # Tinder-style card view
│   │   │   ├── actions/        # Task list
│   │   │   ├── memory/         # Knowledge graph browser
│   │   │   ├── chat/           # Full-screen chat
│   │   │   ├── activity/       # System log
│   │   │   └── settings/       # Connectors, config
│   │   └── api/                # API routes
│   ├── components/             # React components
│   │   ├── ui/                 # shadcn/ui base components
│   │   └── aurelius/           # App-specific components
│   ├── lib/                    # Shared utilities
│   │   ├── db/                 # Drizzle schema & queries
│   │   ├── ai/                 # Claude Max integration
│   │   ├── connectors/         # Gmail, Linear plugins
│   │   └── memory/             # Knowledge graph operations
│   └── worker/                 # Background process entry
├── drizzle/                    # Migrations
├── seed/                       # Initial config & data
└── docs/                       # Plans, notes
```

---

## Database Schema

### Auth & Session

```sql
users (id, email, created_at)
sessions (id, user_id, token, expires_at)
magic_links (id, email, token, expires_at, used_at)
```

### Config (versioned markdown in DB)

```sql
configs (
  id,
  key,              -- 'soul', 'agents', 'processes'
  content,          -- markdown text
  version,          -- incrementing version number
  created_by,       -- 'system' | 'user' | 'aurelius'
  created_at
)
```

### Memory: Entities & Facts

```sql
entities (
  id,
  type,             -- 'person' | 'team' | 'project' | 'company' | 'document' | 'topic'
  name,
  summary,          -- AI-generated, refreshed periodically
  summary_embedding,-- pgvector for semantic search
  metadata,         -- JSONB for type-specific fields
  created_at, updated_at
)

facts (
  id, entity_id,
  content,          -- atomic fact text
  embedding,        -- pgvector
  category,         -- 'relationship' | 'milestone' | 'status' | 'preference' | 'context'
  status,           -- 'active' | 'superseded'
  superseded_by,    -- FK to replacement fact
  source_type,      -- 'triage' | 'chat' | 'document' | 'manual'
  source_id,        -- reference to origin
  access_count, last_accessed,
  created_at
)
```

### Documents

```sql
documents (
  id,
  entity_id,        -- FK to entities (type='document')
  filename,
  content_type,     -- 'application/json' | 'text/markdown' | etc
  raw_content,      -- original text
  processing_status,-- 'pending' | 'processing' | 'completed' | 'failed'
  processed_at,
  created_at
)

document_chunks (
  id, document_id,
  chunk_index,
  content,
  embedding,        -- pgvector
  created_at
)
```

### Triage

```sql
inbox_items (
  id,
  connector,        -- 'gmail' | 'linear'
  external_id,      -- ID in source system
  sender, subject, content,
  raw_payload,      -- JSONB
  status,           -- 'new' | 'archived' | 'snoozed' | 'actioned'
  snoozed_until,
  priority,         -- 'urgent' | 'high' | 'normal' | 'low'
  tags,             -- text[]
  enrichment,       -- JSONB (AI analysis, linked entities, suggestions)
  created_at, updated_at
)

triage_rules (
  id, name,
  trigger,          -- JSONB { connector?, sender?, keyword?, pattern? }
  action,           -- JSONB { type: 'archive' | 'priority' | 'tag', value: ... }
  status,           -- 'active' | 'inactive'
  version,
  created_by,       -- 'user' | 'aurelius'
  created_at
)
```

### Tasks

```sql
tasks (
  id, title, description,
  status,           -- 'todo' | 'in_progress' | 'done'
  priority, due_date,
  project_id,       -- FK to entities (type='project')
  source_item_id,   -- FK to inbox_items (if created from triage)
  linear_issue_id,  -- external Linear ID (null for local tasks)
  created_at, updated_at
)
```

### System

```sql
connectors (
  id, type,         -- 'gmail' | 'linear'
  name,
  credentials,      -- encrypted JSONB
  last_sync_at,
  sync_cursor,      -- JSONB
  poll_interval,
  status,           -- 'active' | 'paused' | 'error'
  error_message,
  created_at, updated_at
)

activity_log (
  id,
  event_type,       -- 'triage_action' | 'memory_created' | 'config_updated' | etc
  actor,            -- 'user' | 'aurelius' | 'system'
  description,
  metadata,         -- JSONB
  created_at
)

conversations (
  id,
  messages,         -- JSONB array
  context,          -- JSONB
  created_at, updated_at
)
```

**Total: 14 tables**

---

## Visual Design

### Color Palette

```css
colors: {
  bg: {
    primary: '#0D0D14',     /* deep navy-black */
    secondary: '#161622',   /* card backgrounds */
    tertiary: '#1E1E2E',    /* hover states, borders */
  },
  gold: {
    DEFAULT: '#D4A853',     /* primary accent */
    muted: '#8B7355',       /* secondary accent */
    bright: '#F4C564',      /* highlights, focus states */
  },
  text: {
    primary: '#E8E6E3',     /* main text */
    secondary: '#9A9A9A',   /* muted text */
    tertiary: '#5A5A6A',    /* disabled, hints */
  },
  status: {
    urgent: '#E54D4D',
    high: '#E89B3C',
    normal: '#4A90A4',
    low: '#5A5A6A',
  }
}
```

### Typography

- **Headings:** Serif (Playfair Display) - stoic, classical
- **Body:** Sans-serif (Inter) - clean, readable
- **Mono:** JetBrains Mono - code, metadata

---

## Triage Interaction

### Card Layout

```
┌─────────────────────────────────────────────┐
│ ⚡ High priority · #q3-planning             │
│ Linked: Sarah Chen (CTO, Acme)       [undo] │
│ "Looks like a scheduling request"           │
├─────────────────────────────────────────────┤
│ [Gmail]                              3 / 47 │
│ From: Sarah Chen                            │
│ Re: Q3 Planning                             │
│ ────────────────────────────────────────    │
│                                             │
│ Email body content here...                  │
│                                             │
├─────────────────────────────────────────────┤
│  ← Archive   ↑ Memory   → Action   ↓ Reply  │
└─────────────────────────────────────────────┘
```

### Arrow Key Actions

| Key | Action | Behavior |
|-----|--------|----------|
| ← | Archive | Dismiss immediately, next card |
| → | Action | Opens submenu: Task / Snooze / Project / Flag |
| ↑ | Memory | Extract to knowledge graph, stays in view |
| ↓ | Reply | Opens draft composer below card |

### Action Submenu (on →)

```
┌─────────────────┐
│ T  Create task  │
│ S  Snooze...    │
│ P  Link project │
│ F  Flag         │
└─────────────────┘
```

---

## Autonomy Model

### Automatic (visible + undoable)

- Create/modify entities
- Supersede facts
- Create/modify triage rules
- Generate embeddings
- Sync connector state
- Update access counts, timestamps
- Write to activity log

All appear inline where they happen + in Activity feed with "Undo" action (7-day window).

### Requires Approval

- Update configs (soul, agents, processes)
- Change model routing
- Modify autonomy levels

Approval happens inline in chat with diff view.

---

## Connector Architecture

```
src/lib/connectors/
├── types.ts          # Connector interface, shared types
├── base.ts           # BaseConnector with common logic
├── registry.ts       # Registration & lookup
├── gmail/
│   ├── index.ts      # GmailConnector
│   ├── auth.ts       # Google OAuth
│   └── normalize.ts  # Gmail → InboxItem
└── linear/
    ├── index.ts      # LinearConnector
    ├── auth.ts       # Linear OAuth
    └── normalize.ts  # Linear → InboxItem
```

Adding a new connector:
1. Create folder `src/lib/connectors/newservice/`
2. Implement the `Connector` interface
3. Register in `registry.ts`
4. Add OAuth credentials to env
5. Connector appears in Settings UI automatically

---

## Chat System

### Two Modes

1. **Full-screen `/chat`** - Dedicated page for deeper conversations
2. **Slide-out panel `Cmd+K`** - Contextually aware from any page

### Context Management

- Injects current page context (triage item, entity, etc.)
- Monitors token usage
- Auto-compacts older messages when approaching limit
- Shows "Conversation compacted" inline
- Important info flows to memory, not lost

### Capabilities

- Query memory: "What do I know about Acme?"
- Give instructions: "Create a rule to auto-archive newsletters"
- Propose config changes (shows diff, inline approval)
- Reference items with @ mentions

---

## Build Phases

### Phase 1: Foundation

- Next.js scaffold with Tailwind + shadcn/ui
- Dark/gold theme setup
- Drizzle + Railway Postgres + pgvector
- Magic link auth
- Config table seeded (soul, agents, processes)
- Activity log writes

### Phase 2: Memory + Chat

- Entities, facts, documents tables
- Claude Max integration
- Chat page (full-screen)
- Memory extraction via chat
- JSON document ingestion CLI
- Seed initial documents
- Vector embeddings
- Memory browser UI (browse, search, undo)

### Phase 3: Chat Polish

- Slide-out panel (Cmd+K)
- Context compaction
- Config changes via chat (with approval flow)
- @ mentions for entities

### Phase 4: Connectors + Triage

- Gmail connector
- Enrichment pipeline (uses memory)
- Triage UI (cards, arrows, AI intel, undo)
- Triage rules engine
- Linear connector

### Phase 5: Actions + Background

- Tasks table, action list UI
- Task creation from triage
- Background worker (connector sync, heartbeat)
- Settings UI

---

## Model Routing

Stored in `configs` table as `agents` key:

| Task | Model | Notes |
|------|-------|-------|
| draft_reply | claude-sonnet-4 | Needs nuance and style |
| classify | claude-haiku | Fast, high volume |
| extract_facts | claude-sonnet-4 | Reasoning about relevance |
| summarize | claude-haiku | Straightforward compression |
| chat | claude-sonnet-4 | Default for conversation |
| chat_complex | claude-opus-4 | Deep analysis on request |

---

## Initial Configs

### soul.md

Defines Aurelius's personality, tone, values. Editable via chat with approval.

### agents.md

Model routing table, autonomy levels, capability boundaries.

### processes.md

Background process schedules (heartbeat, sync, summary regeneration). Editable via Settings UI or chat.

```markdown
## Heartbeat
schedule: "0 * * * *"  # hourly
enabled: true

## Connector Sync
schedule: "*/1 * * * *"  # every minute
enabled: true
```
