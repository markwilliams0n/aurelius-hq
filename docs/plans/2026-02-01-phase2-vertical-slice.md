# Phase 2: Vertical Slice Design

**Date:** 2026-02-01
**Status:** Ready for Implementation

---

## Overview

A minimal end-to-end slice where you can chat with Aurelius, it extracts facts to memory automatically, and you can query that memory in conversation.

**Scope:** Chat UI + Memory extraction + Memory querying
**Deferred:** Documents/chunks, JSON ingestion CLI, Memory browser UI

---

## Decisions

| Area | Decision |
|------|----------|
| AI Provider | OpenRouter |
| Default Model | Kimi 2.5 (`moonshotai/kimi-k2-0711-preview`) |
| Model Routing | Single model for now, routing later |
| Embeddings | OpenAI `text-embedding-3-small` |
| Extraction | Structured output in response (not tool calls) |
| Memory UX | Automatic + visible inline with undo |

---

## Architecture

```
User message
    ↓
┌─────────────────────────────────────────┐
│ 1. Query memory for relevant context    │
│    (semantic search on facts/entities)  │
├─────────────────────────────────────────┤
│ 2. Build prompt with:                   │
│    - System instructions (from soul.md) │
│    - Retrieved memory context           │
│    - Conversation history               │
│    - User message                       │
├─────────────────────────────────────────┤
│ 3. Call Kimi 2.5 via OpenRouter         │
├─────────────────────────────────────────┤
│ 4. Parse response for:                  │
│    - Reply text (show to user)          │
│    - Extracted facts (save to memory)   │
├─────────────────────────────────────────┤
│ 5. Show inline: "Remembered: X" [undo]  │
└─────────────────────────────────────────┘
    ↓
Assistant response
```

---

## Database Schema

Adding to existing 5 tables:

```sql
-- Entities: people, projects, topics, etc.
CREATE TABLE entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL,        -- 'person' | 'project' | 'topic' | 'company'
  name            TEXT NOT NULL,
  summary         TEXT,                 -- AI-generated, updated over time
  summary_embedding VECTOR(1536),       -- for semantic search
  metadata        JSONB DEFAULT '{}',   -- type-specific fields
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Facts: atomic pieces of knowledge linked to entities
CREATE TABLE facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID REFERENCES entities(id),
  content         TEXT NOT NULL,        -- "prefers async communication"
  embedding       VECTOR(1536),
  category        TEXT,                 -- 'preference' | 'relationship' | 'status' | 'context'
  status          TEXT DEFAULT 'active', -- 'active' | 'superseded'
  superseded_by   UUID REFERENCES facts(id),
  source_type     TEXT DEFAULT 'chat',  -- 'chat' | 'document' | 'manual'
  source_id       TEXT,                 -- conversation id or doc id
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations: chat history
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  messages        JSONB NOT NULL,       -- [{role, content, timestamp}]
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Indexes for semantic search
CREATE INDEX ON entities USING ivfflat (summary_embedding vector_cosine_ops);
CREATE INDEX ON facts USING ivfflat (embedding vector_cosine_ops);
```

---

## File Structure

```
src/lib/ai/
├── client.ts        -- OpenRouter client singleton
├── prompts.ts       -- System prompts (chat, extraction)
└── embeddings.ts    -- OpenAI embedding generation

src/lib/memory/
├── entities.ts      -- Create/update/query entities
├── facts.ts         -- Create/supersede/query facts
└── search.ts        -- Semantic search across memory

src/app/(app)/chat/
├── page.tsx         -- Chat page
├── actions.ts       -- Server actions for chat
└── components/
    ├── message-list.tsx
    ├── chat-message.tsx
    ├── chat-input.tsx
    ├── aurelius-avatar.tsx
    └── memory-chip.tsx

src/app/api/chat/
└── route.ts         -- Streaming chat endpoint

src/app/api/memory/
└── [factId]/
    └── route.ts     -- DELETE for undo
```

---

## OpenRouter Integration

```typescript
// src/lib/ai/client.ts
import OpenRouter from '@openrouter/sdk';

export const ai = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

export async function chat(
  input: string | Message[],
  instructions?: string
): Promise<string> {
  const result = ai.callModel({
    model: process.env.OPENROUTER_DEFAULT_MODEL || 'moonshotai/kimi-k2-0711-preview',
    input,
    instructions
  });
  return result.getText();
}

export async function* chatStream(
  input: string | Message[],
  instructions?: string
) {
  const result = ai.callModel({
    model: process.env.OPENROUTER_DEFAULT_MODEL || 'moonshotai/kimi-k2-0711-preview',
    input,
    instructions
  });
  for await (const delta of result.getTextStream()) {
    yield delta;
  }
}
```

```typescript
// src/lib/ai/embeddings.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return response.data[0].embedding;
}
```

---

## Memory Extraction

System prompt instructs model to output facts in structured format:

```
<reply>
Your conversational response here...
</reply>

<memory>
- entity: Mark | type: person | fact: prefers async communication | category: preference
- entity: Acme Corp | type: company | fact: Mark's current client | category: relationship
</memory>
```

Parser extracts `<memory>` block, creates/updates entities and facts, strips from displayed response.

---

## Chat UI

**Route:** `/chat` (full-screen, authenticated)

```
┌──────────────────────────────────────────────────────┐
│ ◉ Aurelius                                      [?]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 👤 You                                         │  │
│  │ What do you know about my communication style? │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ ◉ Aurelius                                     │  │
│  │ Based on our conversations, you prefer async   │  │
│  │ communication and tend to be direct...         │  │
│  │                                                │  │
│  │ ┌──────────────────────────────────────────┐   │  │
│  │ │ 💾 Remembered: Mark values directness   │   │  │
│  │ │                              [undo]     │   │  │
│  │ └──────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ [Send] │
│ │ Type a message...                        │        │
│ └──────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
```

**Components:**
- `ChatPage` - Full-screen layout, manages conversation state
- `MessageList` - Scrollable message container
- `ChatMessage` - Single message bubble (user or assistant)
- `AureliusAvatar` - Agent avatar (gold accent, stoic icon)
- `MemoryChip` - Inline "Remembered: X" with undo button
- `ChatInput` - Text input + send button

**Behavior:**
- Messages stream in
- Memory chips appear after response completes
- Undo removes the fact, shows toast
- Conversation persists to `conversations` table
- Enter to send, Shift+Enter for newline

---

## Environment Variables

```bash
# Add to .env.local
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_DEFAULT_MODEL=moonshotai/kimi-k2-0711-preview
OPENAI_API_KEY=sk-...  # For embeddings only
```

---

## Implementation Order

| # | Step | What |
|---|------|------|
| 1 | Schema | Add `entities`, `facts`, `conversations` tables + pgvector |
| 2 | Migration | Run drizzle migration |
| 3 | AI client | OpenRouter + OpenAI embeddings setup |
| 4 | Memory lib | Create/query entities & facts with embeddings |
| 5 | Chat API | `/api/chat` - handles message, returns streamed response |
| 6 | Chat UI | `/chat` page with components |
| 7 | Extraction | Parse `<memory>` blocks, save facts, show chips |
| 8 | Undo | API + UI for removing facts |

---

## Dependencies

```bash
pnpm add @openrouter/sdk openai zod
```

---

## Deferred to Later

- Documents / document_chunks tables
- JSON ingestion CLI
- Memory browser UI
- Slide-out chat panel (Cmd+K)
- Model routing (multiple models per task)
- Context compaction
