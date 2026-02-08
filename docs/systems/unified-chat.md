# Unified Chat System

> One API, one hook, all surfaces.

## Overview

Every chat surface in Aurelius (main chat, triage modal, Cmd+K panel, Telegram) uses the same pipeline:

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

Telegram is server-side only (no React hook), but uses the same API pipeline.

## ChatContext

Every request includes a `ChatContext` that tells the server what surface is calling and what it knows:

```typescript
type ChatContext = {
  surface: "main" | "triage" | "panel";
  triageItem?: {
    connector: string;
    sender: string;
    senderName?: string;
    subject: string;
    content: string;
    preview?: string;
  };
  pageContext?: string;
  overrides?: {
    skipSupermemory?: boolean;
  };
};
```

- **`surface`** — determines system prompt additions via `buildSurfaceContext()`
- **`triageItem`** — item details for triage chat (injected into system prompt)
- **`pageContext`** — current page info for Cmd+K panel
- **`overrides`** — feature flags (e.g. skip Supermemory writes for triage)

## Chat Surfaces

| Surface | Component | Conversation ID | Context |
|---------|-----------|----------------|---------|
| Main chat | `app/chat/chat-client.tsx` | Shared UUID | `surface: "main"` |
| Triage modal | `components/aurelius/triage-chat.tsx` | Per-item UUID | `surface: "triage"` + item details |
| Cmd+K panel | `components/aurelius/chat-panel.tsx` | Shared UUID | `surface: "panel"` + page context |
| Telegram | `lib/telegram/handler.ts` | Shared UUID | Server-side, no hook |

### Conversation IDs

- **Main chat + Cmd+K + Telegram**: shared `00000000-0000-0000-0000-000000000000` — messages visible across all three
- **Triage chat**: per-item DB UUID — each inbox item gets its own conversation
- Main chat polls every 3s for Telegram sync
- Triage conversations create on first message (404 → insert)

## useChat Hook

`src/hooks/use-chat.ts` — the client-side engine shared by all web surfaces.

```typescript
const {
  messages, isStreaming, isLoading, actionCards, stats,
  send, clear, handleCardAction, updateCardData,
} = useChat({
  conversationId: string,
  context: ChatContext,
  onActionCard?: (card) => void,
});
```

**Responsibilities:**
- SSE stream parsing (text, tool_use, tool_result, action_card, pending_change, etc.)
- Message state management (append, update streaming message)
- Action card state (Map of messageId → cards[])
- Conversation loading on mount (GET /api/conversation/:id)
- External message polling (3s interval for main surface)

## Server Pipeline

`src/app/api/chat/route.ts` handles every chat request:

1. **Load history** — fetch conversation messages from DB
2. **Build context** — `buildAgentContext()` assembles system prompt:
   - Soul + system prompt from config
   - Memory context (Supermemory profile + recent daily notes)
   - Capability prompts (tasks, config, slack tools + instructions)
   - Surface-specific context via `buildSurfaceContext()`
3. **Stream with tools** — `chatStreamWithTools()` with max 5 tool iterations
4. **Extract memories** — save to daily notes + Supermemory (respects overrides)
5. **Save conversation** — persist messages to DB

## SSE Event Types

| Event | Data | Purpose |
|-------|------|---------|
| `text` | `{ content }` | Streaming text tokens |
| `tool_use` | `{ id, name, input }` | Tool call started |
| `tool_result` | `{ tool_use_id, content }` | Tool call result |
| `action_card` | `{ id, type, pattern, data }` | Action card for UI |
| `pending_change` | `{ id }` | Config change pending approval |
| `assistant_message_id` | `{ id }` | Message ID for action card association |
| `conversation` | `{ id }` | Conversation ID (for new conversations) |
| `stats` | `{ model, tokens, duration }` | Request stats |
| `error` | `{ message }` | Error during processing |
| `done` | `{}` | Stream complete |

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/use-chat.ts` | Client-side chat engine (SSE, streaming, action cards) |
| `src/app/api/chat/route.ts` | Server: context-aware streaming pipeline |
| `src/lib/ai/context.ts` | `buildAgentContext()` + `buildSurfaceContext()` |
| `src/lib/ai/client.ts` | `chatStreamWithTools()` — streaming with tool loop |
| `src/lib/types/chat-context.ts` | `ChatContext` type definition |
| `src/lib/memory/extraction.ts` | Post-chat memory extraction (respects overrides) |

## Design Decisions

- **One API route** — no separate routes per surface. Context object drives behavior.
- **Shared conversation** — main + Cmd+K + Telegram share one thread for continuity.
- **Per-item triage conversations** — each inbox item is its own thread, reopening shows history.
- **Create-on-first-message** — triage conversations don't exist until the user sends a message (404 → insert).
- **Surface context injection** — surfaces inject their own system prompt additions without touching the API.
- **Override flags** — triage skips Supermemory writes by default to avoid noise from one-off item questions.

## History

- **Before (pre Feb 7 2026)**: 4 separate chat implementations with inconsistent capabilities. Triage had its own `/api/triage/chat` route with no streaming, no tools, no persistence.
- **After**: One unified system. Triage chat gained streaming, real tools, markdown, action cards, memory extraction, and per-item persistence. `chat-client.tsx` reduced 57% (575 → 248 lines).
