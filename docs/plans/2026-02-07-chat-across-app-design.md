# Chat Across App — Unified Chat Design

> **Branch:** `feature/chat-across-app`
> **Date:** 2026-02-07

## Problem

The app has 4 chat implementations (main chat, Telegram, triage modal, Cmd+K panel) with inconsistent capabilities:

| | Main Chat | Telegram | Triage Chat | Cmd+K Panel |
|---|---|---|---|---|
| Streaming | SSE | Collects then sends | **No** | SSE |
| Tools/Capabilities | Full | Full | **JSON-at-end hack** | Full |
| Memory → Supermemory | Yes | Yes | **No** | Yes |
| Conversation saved | Yes | Yes (shared w/ main) | **No** | Yes (separate) |
| Action Cards | Full (DB-backed) | No (Telegram UI) | **Ephemeral only** | **Not rendered** |
| Markdown rendering | react-markdown | Telegram native | **Plain text** | react-markdown |
| Shared components | ChatMessage, ChatInput | N/A (server-side) | **Custom inline** | ChatMessage, ChatInput |

Triage chat is the biggest outlier — different API route, non-streaming, no real tools, no memory extraction, no persistence.

## Design: One API, One Hook, One Set of Capabilities

### Core Principle

Every chat surface calls the same `/api/chat` endpoint, uses the same `useChat` hook, and gets the same capabilities. Surfaces differ only in:
1. **What context they inject** (triage item details, current page, etc.)
2. **What UI they render** around the messages (full page vs modal vs slide-out)
3. **Behavior overrides** (e.g. skip Supermemory writes)

### `useChat` Hook

Extract all SSE parsing, message state, action cards, and streaming logic from `chat-client.tsx` into a reusable hook:

```typescript
const {
  messages,
  isStreaming,
  actionCards,
  stats,
  send,
  clear,
  loadConversation,
} = useChat({
  conversationId: string,
  context: ChatContext,
  onActionCard?: (card: ActionCardData) => void,
});

type ChatContext = {
  surface: "main" | "triage" | "panel";
  // Surface-specific data
  triageItem?: { connector, sender, senderName, subject, content };
  pageContext?: string;
  // Behavior overrides
  overrides?: {
    skipSupermemory?: boolean;
    // Future: skipDailyNotes, customModel, etc.
  };
};
```

### API: Context-Driven Behavior

Every request to `/api/chat` includes context:

```json
{
  "message": "...",
  "conversationId": "...",
  "context": {
    "surface": "triage",
    "triageItem": { "connector": "gmail", "sender": "...", "subject": "..." }
  }
}
```

The API route passes context through the pipeline:
- `buildAgentContext({ query, context })` — appends surface-specific system prompt
- `chatStreamWithTools()` — unchanged, tools work everywhere
- `extractAndSaveMemories()` — checks `context.overrides` before writing to Supermemory
- Action cards — created and streamed identically regardless of surface

### Surface-Specific Context Injection

`buildAgentContext` delegates to context builders:

- **`surface: "main"`** — no additional context (memory + soul + capabilities is enough)
- **`surface: "triage"`** — appends triage instructions (what actions are available) + item summary (connector, sender, subject, content preview)
- **`surface: "panel"`** — appends page context if provided ("User is on /tasks page")
- **Future surfaces** — just add another case

### Conversation IDs

- **Main chat + Cmd+K + Telegram** — shared `00000000-0000-0000-0000-000000000000`
- **Triage chat** — per-item, e.g. `triage-{itemId}` (persisted, reopening shows history)

### UI Surfaces

#### 1. Chat Page (`/chat`) — Full workspace
Uses `useChat` with `{ surface: "main", conversationId: SHARED_ID }`.
Renders: status bar, memory sidebar, tool panel, action cards, new chat button, Telegram polling.
Shrinks significantly — SSE parsing moves to hook.

#### 2. Triage Modal — Focused, item-aware
Uses `useChat` with `{ surface: "triage", conversationId: triage-${item.id}, triageItem: {...} }`.
Renders: modal overlay, item summary header, messages via `ChatMessage`, action cards, input via `ChatInput`.
No sidebar, no tool panel, no status bar.
Now gets: streaming, real tools, markdown, memory extraction, persistence.

#### 3. Cmd+K Panel — Quick access
Uses `useChat` with `{ surface: "panel", conversationId: SHARED_ID, pageContext: "..." }`.
Renders: slide-out panel, messages, action cards, input.
No sidebar, no tool panel, no status bar.
Now gets: action card rendering, shared conversation with main chat.

## Changes

### Created
- `src/hooks/use-chat.ts` — shared chat hook

### Deleted
- `src/app/api/triage/chat/route.ts` — replaced by `/api/chat` with triage context
- `TRIAGE_CONTEXT` inline prompt — moves to context builder
- `buildAndPersistSlackCard` / `saveFactToMemory` helpers — replaced by capability tools

### Modified
- `src/app/api/chat/route.ts` — accept `context` object, pass through pipeline
- `src/lib/ai/context.ts` — surface-specific context injection in `buildAgentContext`
- `src/lib/memory/extraction.ts` — accept context, respect overrides
- `src/app/chat/chat-client.tsx` — refactor to use `useChat` (shrinks ~200 lines)
- `src/components/aurelius/chat-panel.tsx` — refactor to use `useChat`, add action cards
- `src/components/aurelius/triage-chat.tsx` — rewrite to use `useChat` + shared components
