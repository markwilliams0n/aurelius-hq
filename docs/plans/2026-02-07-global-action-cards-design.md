# Global Action Cards Design

**Date:** 2026-02-07
**Linear:** PER-163

## Overview

Action Cards are a standardized chat-native container for interactive content. Any tool in the system can surface a card to the user that conveys data, requests a decision, or needs approval before executing an action.

The card itself is the **container** — a persisted object with a lifecycle. Inside it, a **content pattern** defines the UI layout and interaction model. A **handler** defines what happens when the user takes action.

## Mental Model

```
Card (container)
├── Pattern (UI: approval, config, confirmation, info)
├── Handler (execution: slack:send-message, gmail:send-email, etc.)
└── Data (payload: whatever the pattern + handler need)
```

When building a new tool or feature, you don't design UI. You pick a pattern, wire up a handler (or reuse one), and return a card from your tool. The platform renders it.

## Data Model

New `action_cards` table:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text PK | `card-{timestamp}-{random}` |
| `message_id` | text | Links to the chat message that created it |
| `conversation_id` | text | Which chat conversation |
| `pattern` | text | `approval`, `config`, `confirmation`, `info` |
| `status` | text | `pending`, `confirmed`, `dismissed`, `error` |
| `title` | text | Short label ("Slack message to #general") |
| `data` | jsonb | Pattern-specific payload |
| `handler` | text (nullable) | Execution handler ID (e.g. `slack:send-message`) |
| `result` | jsonb (nullable) | Outcome after execution (URL, error, metadata) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Cards are created by tools, stored immediately in DB, and emitted to the chat client. Status updates go through the API route and update the DB row.

## Content Patterns

Each pattern defines a UI layout and available actions.

### `approval` — "Review this and decide"

- Body: rendered content (markdown, structured fields, or both)
- Actions: primary action (send/create/approve) + cancel
- Optional: inline editing before approval, toggles, recipient display
- Used for: Slack messages, emails, task creation, any "do this thing" flow

### `config` — "Here's state you can view or change"

- Body: key-value pairs or form layout, editable in pending state
- Actions: save + dismiss (explicit save, not auto-save)
- Used for: capability prompts, connector settings, system preferences shown in chat

### `confirmation` — "Yes or no, quick"

- Body: short description of what will happen
- Actions: confirm + cancel
- Lightweight — no editing, no rich content
- Used for: destructive actions, "are you sure?" moments

### `info` — "FYI, no action required"

- Body: rendered content (markdown, data table, etc.)
- Actions: dismiss (or none)
- Used for: search results, status reports, "here's what I found"

## Handler Registry

Handlers are the execution layer. Registered by name, matched via the card's `handler` field.

```typescript
// src/lib/action-cards/registry.ts
type CardHandler = {
  execute: (data: Record<string, unknown>) => Promise<CardHandlerResult>;
  label: string;        // "Send" / "Create" / "Save"
  successMessage: string; // "Message sent!" / "Issue created!"
};

type CardHandlerResult = {
  status: "confirmed" | "error";
  resultUrl?: string;
  resultMeta?: Record<string, unknown>;
  error?: string;
};
```

### Initial Handlers

| Handler ID | What it does | Pattern |
|-----------|-------------|---------|
| `slack:send-message` | Sends via Slack API (DM or channel) | approval |
| `gmail:send-email` | Sends via Gmail API | approval |
| `linear:create-issue` | Creates a Linear issue | approval |

### Handler Location

`src/lib/action-cards/handlers/<name>.ts` — each exports a handler function and auto-registers on import. Same pattern as capabilities.

### API Route

The route becomes a thin dispatcher:

1. Load card from DB by ID
2. Generic actions (cancel, dismiss, edit) → update status directly
3. Primary actions → look up handler by `card.handler`, call `execute(card.data)`, store result, update status
4. Cards without handlers are display-only

### Error Handling

If a handler throws, card moves to `error` status, error stored in `result`. User can retry (back to `pending`) or dismiss.

## Chat Integration

### Creation Flow

1. Capability tool returns `{ action_card: { pattern, handler, title, data } }` in result
2. Chat route intercepts, writes card to `action_cards` table, assigns ID
3. Card emitted to client via SSE (main chat) or JSON response (triage chat)
4. Client renders card below the message

### Action Flow

1. User clicks action button
2. Client POSTs to `/api/action-card/[id]` with `{ action }`
3. API loads card from DB, dispatches to handler or updates status
4. Result written to DB
5. Response sent to client, UI updates

### Page Refresh

Cards loaded from DB when conversation loads. Client reconstructs card state from persisted data.

### Triage Chat Alignment

Triage chat currently has its own card creation logic (`buildSlackActionCard`). This gets replaced — triage chat tools return `action_card` in the same format as main chat. Same components, same API, same handlers.

### Outside of Chat

Cards are in DB with `conversation_id` and `status`. Other parts of the app can query pending cards for notification trays, dashboards, etc.

## Implementation Steps

### Step 1: Database table + CRUD
- Create `action_cards` table migration
- DB functions: `createCard`, `getCard`, `updateCard`, `getCardsByConversation`

### Step 2: Handler registry
- Registry module at `src/lib/action-cards/registry.ts`
- Extract Slack send handler from current API route
- Updated API route: load from DB, dispatch to registry

### Step 3: Pattern components
- Refactor ActionCard shell to be pattern-aware
- `approval` pattern (generalizes current Slack card)
- `info`, `confirmation`, `config` patterns (lightweight)
- Content dispatcher routes by pattern

### Step 4: Chat integration
- Main chat: card creation writes to DB, loads on conversation load
- Triage chat: same format, same components, same API
- Remove duplicated Slack card building from triage route

### Step 5: Gmail + Linear handlers
- `gmail:send-email` handler
- `linear:create-issue` handler
- Wire into existing capabilities

### Step 6: Config pattern
- Config viewer/editor card component
- Save handler that writes to config system
- Wire up as agent tool
