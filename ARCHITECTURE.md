# Aurelius Architecture

> **Living document** - Update this when making structural changes.

## Overview

Aurelius is a personal AI assistant with persistent memory, multi-channel access (web + Telegram), and extensible integrations. Built with Next.js 15, PostgreSQL + pgvector, and OpenRouter for AI.

## Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── chat/          # Unified chat endpoint (streaming, all surfaces)
│   │   ├── conversation/  # Conversation CRUD
│   │   ├── daily-notes/   # Daily notes read/write
│   │   ├── memory/        # Memory search API
│   │   ├── config/        # Config management + pending changes
│   │   ├── telegram/      # Telegram webhook + setup
│   │   ├── triage/        # Inbox items management
│   │   └── action-card/   # Action card execution
│   ├── chat/              # Web chat UI
│   └── triage/            # Triage page
│
├── components/aurelius/   # UI components
│   ├── chat-*.tsx         # Chat interface components
│   ├── triage-chat.tsx    # Triage chat modal (uses shared useChat hook)
│   ├── chat-panel.tsx     # Cmd+K slide-over panel (uses shared useChat hook)
│   ├── action-card.tsx    # Generic action card container
│   ├── cards/             # Card content renderers (Gmail, Linear, Slack, Config)
│   ├── tool-panel.tsx     # Right sidebar (resizable)
│   ├── app-shell.tsx      # Layout wrapper
│   └── memory-*.tsx       # Memory display components
│
├── hooks/                 # React hooks
│   └── use-chat.ts        # Shared chat engine (SSE, streaming, action cards)
│
├── lib/                   # Core logic
│   ├── ai/                # AI client + context building
│   ├── capabilities/      # Agent capabilities (tools + prompts)
│   │   ├── config/        # Self-modification tools
│   │   └── tasks/         # Linear task management
│   ├── db/                # Database connection + schema
│   ├── linear/            # Linear API client + issues
│   ├── memory/            # Memory operations
│   ├── slack/             # Slack integration (directory, sending)
│   ├── telegram/          # Telegram integration
│   ├── types/             # Shared types (ChatContext, ActionCard, etc.)
│   └── config.ts          # Config management
```

## Core Systems

### 1. AI Client (`lib/ai/client.ts`)

- **Provider**: OpenRouter (supports multiple models)
- **Default model**: `moonshotai/kimi-k2`
- **Tool model**: `anthropic/claude-sonnet-4` (reliable function calling)
- **Key function**: `chatStreamWithTools()` - streaming with tool loop (max 5 iterations)

### 2. Memory System

> **Detailed docs:** [docs/systems/memory.md](docs/systems/memory.md) | [Daily Notes](docs/systems/daily-notes.md)

**Two storage layers:**

| Layer | Location | Purpose |
|-------|----------|---------|
| Short-term | `memory/*.md` | Daily notes — last 24h, direct file read |
| Long-term | Supermemory (cloud API) | Knowledge graph, profile facts, semantic search |

**Chat context sources:**
- **Recent Activity** (last 24h): Direct file read from daily notes
- **Relevant Memory**: Supermemory profile API (static facts + dynamic context)

**Key files:**
- `lib/memory/supermemory.ts` - Supermemory client (`addMemory`, `getMemoryContext`, `searchMemories`)
- `lib/memory/search.ts` - `buildMemoryContext()` — formats Supermemory results for AI prompts
- `lib/memory/daily-notes.ts` - Append-only daily logs + recent notes retrieval
- `lib/memory/extraction.ts` - Saves conversations to daily notes + Supermemory
- `lib/memory/ollama.ts` - Local LLM for triage summarization + enrichment

### 3. Heartbeat System

> **Detailed docs:** [docs/systems/heartbeat.md](docs/systems/heartbeat.md)

Heartbeat is the **connector sync system** that pulls data from external sources:

```
External Sources                   Triage Inbox
────────────────                   ────────────
Granola meetings             ┐
Gmail emails                 ├──→  HEARTBEAT  ──→  inbox_items table
Linear issues                │     (every 15m)
Slack messages               ┘
```

**What it does:**
1. Syncs Granola meetings → triage inbox
2. Syncs Gmail → triage inbox
3. Syncs Linear issues → triage inbox
4. Syncs Slack messages → triage inbox

**Memory extraction** is handled separately: chat conversations and triage saves send content to Supermemory directly (no heartbeat needed).

**Scheduling:**
- Runs automatically every 15 minutes via `node-cron` (configurable)
- Manual trigger via System page or `POST /api/heartbeat`

**Key files:**
- `lib/memory/heartbeat.ts` - Connector sync orchestration
- `app/api/heartbeat/route.ts` - API endpoint
- `instrumentation.ts` - Scheduler setup

### 4. Database Schema (`lib/db/schema/`)

```
entities          - People, projects, topics, companies
facts             - Atomic facts linked to entities (with embeddings)
documents         - Raw documents for ingestion
document_chunks   - Chunked + embedded document pieces
conversations     - Chat history (shared between web + Telegram)
inbox_items       - Triage inbox from connectors
triage_rules      - Automation rules for inbox
configs           - Versioned configuration (soul, prompts, etc.)
pending_changes   - Config changes awaiting approval
```

### 5. Unified Chat System

> **Detailed docs:** [docs/systems/unified-chat.md](docs/systems/unified-chat.md)

**One API, one hook, all surfaces.** Every chat surface (main, triage, Cmd+K, Telegram) uses the same pipeline:

```
┌─────────────┐   ChatContext    ┌──────────────┐
│  useChat()  │ ──────────────→  │  /api/chat   │
│  (React)    │   {surface,      │  (streaming)  │
│             │    triageItem,   │              │
│  Surfaces:  │    overrides}    │  Pipeline:   │
│  • Main     │                  │  1. Load history
│  • Triage   │  ← SSE stream ← │  2. Build context (memory + surface)
│  • Cmd+K    │   text, tools,   │  3. Stream with tools
│  • Telegram │   action_cards   │  4. Extract memories
│             │                  │  5. Save conversation
└─────────────┘                  └──────────────┘
```

**ChatContext** tells the server what surface is calling and what it knows:
- `surface`: `"main"` | `"triage"` | `"panel"` — determines system prompt additions
- `triageItem`: Item details for triage chat (connector, sender, subject, content)
- `overrides`: Feature flags like `skipSupermemory`

**Conversation IDs:**
- Main chat + Cmd+K + Telegram: shared `00000000-0000-0000-0000-000000000000`
- Triage chat: per-item UUID (the inbox item's DB ID)

**Key files:**
- `hooks/use-chat.ts` — Client-side engine: SSE parsing, streaming state, action cards, conversation loading
- `app/api/chat/route.ts` — Server: context-aware streaming with create-on-first-message for new conversations
- `lib/ai/context.ts` — `buildAgentContext()` with `buildSurfaceContext()` for surface-specific prompts
- `lib/types/chat-context.ts` — `ChatContext` type definition

### 6. Agent Capabilities (`lib/capabilities/`)

> **Detailed docs:** [docs/systems/capabilities.md](docs/systems/capabilities.md)

Modular, self-modifiable agent skills. Each capability provides tools + instructions.

**Current capabilities:**
| Capability | Tools | Purpose |
|-----------|-------|---------|
| **Config** | `list_configs`, `read_config`, `propose_config_change` | Agent reads/modifies its own config |
| **Tasks** | `list_tasks`, `create_task`, `update_task`, `get_task`, `get_team_context`, `get_suggested_tasks` | Manage tasks via Linear |

**Key design:**
- DB is source of truth for capability prompts (seeded from code on first access)
- Agent can propose prompt changes → user approves via slide-out diff panel
- All chat surfaces (web, Telegram) get capabilities via `buildAgentContext()` + `chatStreamWithTools()`

### 7. Configuration System (`lib/config.ts`)

- **Keys**: `soul`, `system_prompt`, `agents`, `processes`, `capability:tasks`, `capability:config`
- **Versioned**: Every change creates new version
- **Approval workflow**: AI proposes → user approves/rejects
- **Tools**: `list_configs`, `read_config`, `propose_config_change` (via config capability)

## Integrations

### Telegram (`lib/telegram/`)

**Pattern for external integrations:**

```
lib/telegram/
├── client.ts      # API wrapper (sendMessage, setWebhook, etc.)
├── handler.ts     # Message processing + AI integration
└── index.ts       # Exports

api/telegram/
├── webhook/route.ts  # Receives updates from Telegram
└── setup/route.ts    # Configure webhook URL
```

**Key design decisions:**
- Shared conversation ID (`00000000-0000-0000-0000-000000000000`) syncs with web
- Full AI integration (same tools, memory, extraction as web)
- Async processing (return 200 immediately)
- Message splitting for Telegram's 4096 char limit

### Granola (`lib/granola/`)

**Meeting notes sync from Granola app:**

```
lib/granola/
├── client.ts      # API wrapper + OAuth token rotation
├── sync.ts        # Sync meetings to triage inbox
└── index.ts       # Exports

api/connectors/granola/
└── setup/route.ts # Initial token setup (POST/GET/DELETE)
```

**Key design decisions:**
- Uses WorkOS OAuth with rotating refresh tokens (single-use)
- Tokens stored in `configs` table as `connector:granola`
- Sync runs during heartbeat (fetches meetings since last sync)
- Full meeting transcripts stored in triage `rawPayload`

**Setup:** Extract `refresh_token` and `client_id` from Granola app, POST to `/api/connectors/granola/setup`.

### Triage/Inbox System (`lib/db/schema/triage.ts`)

**Unified inbox for external sources:**
- Connectors: `gmail`, `slack`, `linear`, `granola`, `manual`
- Stores raw payloads + normalized fields
- AI enrichment: summary, priority, suggested actions
- Rules engine for automation

## UI Architecture

### Chat Surfaces

All chat surfaces share the `useChat` hook (`hooks/use-chat.ts`) for consistent behavior:

| Surface | Component | Conversation ID | Context |
|---------|-----------|----------------|---------|
| Main chat | `app/chat/chat-client.tsx` | Shared UUID | `surface: "main"` |
| Triage modal | `components/aurelius/triage-chat.tsx` | Per-item UUID | `surface: "triage"` + item details |
| Cmd+K panel | `components/aurelius/chat-panel.tsx` | Shared UUID | `surface: "panel"` + page context |
| Telegram | `lib/telegram/handler.ts` | Shared UUID | (server-side, no hook) |

- Main chat polls every 3s for Telegram sync
- Triage conversations create on first message (404 → insert)

### Tool Panel (`components/aurelius/tool-panel.tsx`)

**Resizable right sidebar supporting:**
- `config_view` - Display config content
- `config_diff` - Show proposed changes with approve/reject
- `tool_result` - Generic tool output
- `daily_notes` - View/add daily notes

### App Shell (`components/aurelius/app-shell.tsx`)

```
┌─────────────────────────────────────────────────┐
│ AppSidebar │    Main Content    │  Right Panel  │
│  (nav)     │    (children)      │  (optional)   │
└─────────────────────────────────────────────────┘
```

## Deployment

**This app runs locally**, not on Vercel or other cloud platforms.

- **Runtime**: Local development server (`bun run dev` or `next dev`)
- **Database**: Neon PostgreSQL (cloud-hosted, accessed from local)
- **Background tasks**: Must be scheduled locally (node-cron, system cron, or launchd)
- **Telegram**: Requires tunnel (ngrok) for webhook to reach local server

**Not using:**
- Vercel (no serverless functions, no Vercel cron)
- Docker (runs directly on macOS)
- PM2 or similar process managers

**Implications for scheduling:**
- Heartbeat must be triggered via local scheduler
- No `maxDuration` limits apply (those are Vercel-specific, can be removed)
- Long-running operations are fine

## Environment Variables

```bash
DATABASE_URL          # PostgreSQL connection (Neon)
OPENROUTER_API_KEY    # AI provider
SUPERMEMORY_API_KEY   # Long-term memory (Supermemory)
TELEGRAM_BOT_TOKEN    # Telegram bot
WORKOS_*              # Authentication
```

## Adding New Integrations

Follow the Telegram pattern:

1. **Create connector module** (`lib/<name>/`)
   - `client.ts` - API wrapper
   - `handler.ts` - Message processing
   - Types/interfaces for the external API

2. **Create webhook endpoint** (`api/<name>/webhook/`)
   - Return 200 immediately
   - Process async with handler

3. **Integrate with core systems**
   - Use `buildMemoryContext()` for context
   - Use `chatStreamWithTools()` for AI responses
   - Call `extractAndSaveMemories()` for learning
   - Decide: shared conversation ID or separate?

4. **Optional: Add to triage**
   - Register connector type
   - Configure ingest rules

## Key Patterns

- **Unified chat**: All surfaces share `useChat` hook + `/api/chat` with `ChatContext` for surface-specific behavior
- **Streaming**: All AI responses stream via SSE (text, tool_use, tool_result, action_card events)
- **Tool loops**: Max 5 iterations to prevent runaway
- **Action cards**: DB-persisted structured actions below chat messages (approval, config, confirmation, info patterns). Handler registry dispatches execution.
- **Memory extraction**: Chat → daily notes + Supermemory (overridable via `context.overrides.skipSupermemory`)
- **Config approval**: AI proposes, human approves
- **Shared state**: Main chat + Cmd+K + Telegram use same conversation; triage uses per-item conversations
- **Polling sync**: Web polls for external messages (3s interval)
