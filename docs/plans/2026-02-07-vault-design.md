# Vault: Document & Fact Storage System

> **Design document** — Brainstormed 2026-02-07. Not yet an implementation plan.

## Purpose

Aurelius Vault is a local-first document library and structured fact store. It lets Mark capture documents (PDFs, text, etc.) and hard facts (passport numbers, policy numbers, traveler IDs) with AI-powered classification. Everything is stored persistently in the local PostgreSQL database with full original content preserved.

SuperMemory integration is opt-in and explicit — nothing leaves the vault unless approved, and sensitive values never reach SuperMemory.

## Core Principles

1. **Local-first** — all content stored in PostgreSQL, full originals preserved
2. **AI-organized** — Ollama auto-classifies with tags from existing pool, user can edit
3. **SuperMemory is opt-in** — vault page never sends to SM without explicit approval
4. **Sensitive gating** — sensitive values (SSN, passport #) never appear in chat text or reach SM. Enforced architecturally (sensitive values never in AI context), not by prompt instructions.
5. **Two search paths** — SM for general knowledge recall, vault for original documents and sensitive facts

## Data Model

### `vault_items` table (new)

```sql
CREATE TYPE vault_item_type AS ENUM ('document', 'fact', 'credential', 'reference');
CREATE TYPE supermemory_status AS ENUM ('none', 'pending', 'sent');

CREATE TABLE vault_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          vault_item_type NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT,                    -- full text for facts/credentials, document body for text, null for binary
  file_data     BYTEA,                   -- binary content for PDFs, DOCX, etc.
  file_name     TEXT,                    -- original filename
  content_type  TEXT,                    -- MIME type (application/pdf, text/plain, etc.)
  sensitive     BOOLEAN NOT NULL DEFAULT FALSE,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  source_url    TEXT,                    -- optional: Linear doc URL, web link, etc.

  -- SuperMemory sync tracking
  supermemory_status    supermemory_status NOT NULL DEFAULT 'none',
  supermemory_level     TEXT,            -- 'short', 'medium', 'detailed', 'full'
  supermemory_summary   TEXT,            -- what was actually sent (for reference)

  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vault_items_tags ON vault_items USING GIN (tags);
CREATE INDEX idx_vault_items_search ON vault_items USING GIN (to_tsvector('english', title || ' ' || COALESCE(content, '')));
```

**No chunking, no embeddings.** SuperMemory handles semantic search. Vault uses PostgreSQL full-text search for local queries.

**Important:** `content` must always be populated with searchable text. For PDFs/DOCX, text is extracted on upload into `content`; `file_data` stores the original binary for faithful retrieval. If text extraction fails, `content` falls back to the filename + any user-provided description so the item is still searchable.

### Tags

Flat tags, no hierarchy. AI picks from existing tags in the DB first, suggests new ones only when nothing fits. Examples: `insurance`, `travel`, `identity`, `legal`, `medical`, `financial`, `housing`.

## Vault Capability (Agent Tools)

New capability at `src/lib/capabilities/vault/index.ts` following the existing pattern.

**Requires:** `capability:vault` config key added to `configKeyEnum` (DB migration: `ALTER TYPE config_key ADD VALUE 'capability:vault'`).

### Tool: `save_to_vault`

Triggered by: "save my...", "vault this...", "remember my..."

**Input:**
```typescript
{
  title?: string,      // AI generates if not provided
  content: string,     // the actual value or text
  type?: "fact" | "credential" | "document" | "reference",
  sensitive?: boolean, // AI infers if not specified
  tags?: string[],     // AI suggests from existing pool
  sourceUrl?: string
}
```

**Flow:**
1. AI calls tool with content
2. Ollama classifies: title, type, tags, sensitive (checks existing tags from DB)
3. Saves to `vault_items`
4. Returns Action Card showing result — all fields editable
5. Action Card includes SuperMemory options: Short | Medium | Detailed | Full | Skip

### Tool: `search_vault`

Triggered by: "what's my...", "find my...", "look up..."

**Input:**
```typescript
{
  query: string,
  id?: string,         // direct lookup by vault_item_id (for SM recall loop)
  tags?: string[],
  type?: string
}
```

**Flow:**
1. If `id` provided: direct lookup by vault_item_id
2. Otherwise: PostgreSQL full-text search on title + content
3. Optional tag/type filters
4. **Non-sensitive results**: returned in chat, AI can reference values
5. **Sensitive results**: tool response returns **metadata only** (title, type, tags, `sensitive: true`, `vault_item_id`). The actual value is NEVER in the tool response.

**Sensitive recall — architectural enforcement:**

The sensitive value never enters the AI context. Instead:
- Tool response: `{ title: "US Passport", sensitive: true, vault_item_id: "uuid" }`
- AI responds: "I found your passport details — check the card below."
- Tool response also includes `action_card: { type: "vault_reveal", vault_item_id: "uuid" }`
- Client renders an Action Card that fetches the value via a **separate API call** (`GET /api/vault/items/{id}/reveal`) — this call never touches the AI

```
Chat: "I found your passport details — check the card below."

┌─ Vault: US Passport ─────────────────────┐
│ Sensitive                                 │
│ Number: X12345678    [fetched client-side] │
│ Expires: 2032-01-15                       │
│ Issuer: US Department of State            │
└───────────────────────────────────────────┘
```

This means even if the AI hallucinates or ignores instructions, the sensitive value physically cannot appear in chat text or reach SuperMemory.

## SuperMemory Integration

### Sending to SuperMemory

Always requires explicit approval. Flow:

1. User clicks a summary level (Short | Medium | Detailed | Full)
2. Ollama generates summary locally at that level
3. Action Card shows **preview of what will be sent** — editable
4. User clicks "Approve & Send" or "Cancel"
5. On approve:

```typescript
addMemory(approvedSummary, {
  vault_item_id: item.id,
  vault_type: item.type,
  sensitive: item.sensitive,
  summary_level: "short",
  source: "vault"
});
```

6. `vault_items.supermemory_status` → `"sent"`, stores level and summary text

### Summary Levels

| Level | What Ollama generates | Example (insurance policy) |
|-------|----------------------|---------------------------|
| Short | One-line fact | "Mark has auto insurance with State Farm, policy #XYZ" |
| Medium | Key details paragraph | Policy number, coverage, dates, deductible |
| Detailed | Multi-paragraph | All above + exclusions, contacts, claim process |
| Full | Complete content | Entire document text sent as-is |

**Sensitive items:** Ollama excludes the actual sensitive value from ALL summary levels. Passport entry becomes "Mark has a US passport, expires Jan 2032" — no number.

### SuperMemory Recall Loop

When SuperMemory returns a result with `vault_item_id` in metadata:
1. AI sees "this item has a linked vault document"
2. If user needs more detail, AI calls `search_vault` with that ID
3. Full/sensitive content returned via Action Card

## Vault Page (`/vault`)

### Chat Surface

The vault page has its own AI input and needs its own chat API route, similar to how triage has `/api/triage/chat/route.ts`.

- **Route:** `POST /api/vault/chat` — loads only the vault capability, returns structured actions
- **Conversation:** dedicated vault conversation (persisted, like triage chat has a per-item conversation). This is needed because action cards require a `conversationId` FK.
- **Capabilities loaded:** vault only (no tasks, no config, no slack)
- **No memory extraction** on vault chat messages — this surface is for vault operations, not general conversation

### Additional API Routes

- `GET /api/vault/items` — list recent items, search, filter by tags/type
- `GET /api/vault/items/{id}` — get vault item (metadata + non-sensitive content)
- `GET /api/vault/items/{id}/reveal` — get sensitive value (client-only, never via AI)
- `POST /api/vault/items` — create vault item directly (for file uploads, manual entry)
- `PATCH /api/vault/items/{id}` — update tags, title, sensitive flag
- `POST /api/vault/items/{id}/supermemory` — generate summary preview, then send on approval
- `POST /api/vault/upload` — file upload endpoint (multipart form data via `Request.formData()`)
- `GET /api/vault/tags` — list all existing tags (for Ollama classification + UI filter chips)

### Layout

```
┌──────────────────────────────────────────────────┐
│  Sidebar  │         Vault                        │
│  (nav)    │                                      │
│           │  ┌─ AI Input ────────────────────┐   │
│           │  │ "Save my TSA PreCheck #..."    │   │
│           │  │         [Upload] [Send]        │   │
│           │  └───────────────────────────────┘   │
│           │                                      │
│           │  ┌─ Action Cards (transient) ─────┐  │
│           │  │ Saved: TSA PreCheck Number      │  │
│           │  │ Tags: travel, identity  [edit]  │  │
│           │  │ [Send to SM: Short|Med|Full]    │  │
│           │  └───────────────────────────────┘   │
│           │                                      │
│           │  ┌─ Search + tag filters ─────────┐  │
│           │  │ Search...  | tag | tag | all   │  │
│           │  └───────────────────────────────┘   │
│           │                                      │
│           │  ┌─ Recent items (last ~20) ──────┐  │
│           │  │ State Farm Auto Policy          │  │
│           │  │ US Passport Number              │  │
│           │  │ Condo HOA Agreement             │  │
│           │  └───────────────────────────────┘   │
│           │                                      │
└──────────────────────────────────────────────────┘
```

### Key Behaviors

- **AI Input (top)**: text input + file upload (drag-and-drop or click). Upload without text is fine — AI auto-classifies from filename + content.
- **Action Cards**: appear between input and item list. Transient results of what you just did. SuperMemory options with preview-before-send.
- **Search**: PostgreSQL full-text search, replaces recent list with results.
- **Tag filters**: chips populated from all tags in DB. Click to filter.
- **Recent items**: default view, last ~20 items. Click to expand inline: full content (or "reveal" button for sensitive), edit tags/title, SM status.
- **No SuperMemory interaction unless explicitly approved** — this page is a safe zone.

### File Upload Support

- **PDF**: extract text via `pdf-parse` library, store binary in `file_data` + extracted text in `content`
- **DOCX**: extract text via `mammoth` library, store binary in `file_data` + extracted text in `content`
- **Plain text**: store directly in `content` (no binary needed)
- **Links/references**: store URL + optional description (type: `reference`)

File upload uses Next.js built-in `Request.formData()` — no additional middleware needed. No existing file upload infrastructure in the codebase, so this is net new.

### Item Display

Each item shows:
- Icon by type (document, fact, credential, reference)
- Lock icon for sensitive items
- Title, tags, date added
- Click to expand: full content, edit controls, SM status + send options

## Chat Integration

### Save via Chat

```
User: "Save my frequent flyer number AA1234567"

AI calls save_to_vault → saved to DB

┌─ Saved to Vault ──────────────────────────┐
│ AA Frequent Flyer Number                   │
│ Type: credential  Sensitive: no            │
│ Tags: travel, airlines           [edit]    │
│                                            │
│ Send to SuperMemory?                       │
│ [Short] [Medium] [Detailed] [Full] [Skip] │
└────────────────────────────────────────────┘
```

### Recall via Chat

Non-sensitive:
```
User: "What's my insurance policy number?"
AI: "Your State Farm auto policy number is XYZ-123."
```

Sensitive:
```
User: "What's my SSN?"
AI: "I found your SSN — check the card below."

┌─ Vault: Social Security Number ───────────┐
│ Sensitive                                  │
│ XXX-XX-6789                                │
└────────────────────────────────────────────┘
```

### Memory Extraction Boundary

- Chat messages themselves go through normal memory extraction (fine — "save my passport number" is vague enough)
- Vault *contents* only reach SuperMemory when explicitly approved via Action Card
- Sensitive values in Action Cards are outside the chat stream — never extracted

## Ollama Classification

On save, Ollama receives:
- The content (or first ~500 chars for large documents)
- List of existing tags from DB
- Item type hint (if user specified)

Returns:
- Suggested title (if not provided)
- Suggested tags (prefer existing, max 2 new)
- Type inference (fact vs credential vs document)
- Sensitive detection (pattern-based + AI judgment for SSNs, passport numbers, etc.)

## Dependencies (New)

- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX text extraction

## DB Migrations Required

1. `vault_item_type` enum
2. `supermemory_status` enum
3. `vault_items` table + indexes
4. `ALTER TYPE config_key ADD VALUE 'capability:vault'`

## Future Considerations (Not in V1)

- Full library/browse page with grouping when collection grows
- PDF/DOCX viewer inline
- Linear doc and web URL import (fetch + store)
- Bulk import
- Export/backup
- Vault item versioning
- Sharing specific items
