# Slack Sending & Action Cards Design

**Date:** 2026-02-06
**Branch:** `feature/slack-sending`
**Status:** Design

## Overview

Add the ability for Aurelius to send Slack messages — DMs to people, posts to channels, and agent-initiated reminders. Messages are always drafted for user confirmation before sending.

This also introduces a general-purpose **Action Card** system for rendering structured, actionable objects below chat messages (Slack drafts now, tasks/emails/Linear issues later), and upgrades chat rendering from plain text to markdown.

## Use Cases

1. **Triage reaction:** "I received an email about an invoice getting paid — DM Harvy to let him know"
2. **Conversational:** "Draft a message about the campaign results and post to #marketing"
3. **Agent-initiated:** Aurelius DMs you reminders or notifications

## Slack API Constraints

| Constraint | Handling |
|---|---|
| Bot DMs show as bot identity | Fine — messages come from "Aurelius" |
| DMs are 1:1 bot-to-user by default | Use group DM (MPIM) with you + recipient so you stay in the loop |
| Channel posts need `chat:write.public` for non-member channels | Add scope to bot |
| Private channels need bot to be invited | Only post where bot is a member |
| mrkdwn not standard Markdown | Agent formats in Slack syntax |
| 4,000 char recommended limit | Split long messages if needed |
| Rate limit: ~1 msg/sec/channel | Fine for our use case |

**Required OAuth scopes** (add if not already present):
- `chat:write` — send to channels bot is in
- `chat:write.public` — send to any public channel
- `users:read` — cache user directory
- `channels:read` + `groups:read` — cache channel directory

## Design

### 1. Markdown Rendering in Chat

Replace plain text rendering in `ChatMessage` with markdown.

- Add `react-markdown` + `remark-gfm`
- Replace `<p className="whitespace-pre-wrap">` with markdown renderer
- Style with Tailwind prose classes (already used in `triage-detail-modal.tsx`)
- Independent of everything else — quick win

**Files:**
- Modify: `src/components/aurelius/chat-message.tsx`
- Modify: `package.json` (new deps)

### 2. Action Card System

A general-purpose structured card that renders below chat messages with confirm/deny/edit actions.

**Card anatomy:**
```
┌─ Action Card ───────────────────────┐
│ 📨 Slack Message                    │  ← Type header (icon + label)
│                                     │
│ To: Harvy Ruiz (+ you)             │  ← Structured fields
│ Via: Group DM                       │
│                                     │
│ Hey Harvy, heads up — the invoice   │  ← Content body
│ from Acme Corp just got paid.       │
│                                     │
│        [Edit]  [Send]  [Cancel]     │  ← Action buttons
└─────────────────────────────────────┘
```

**Card properties:**
- `id` — unique identifier
- `cardType` — "slack_message", "task", "email_draft", etc.
- `status` — "pending", "confirmed", "canceled", "sent", "error"
- `data` — type-specific payload
- `actions` — available buttons (type-specific)

**SSE integration:**
- New event type: `type: "action_card"` with JSON payload
- Cards associated with the message that generated them
- Button clicks call: `POST /api/action-card/[id]/confirm`

**Files:**
- New: `src/components/aurelius/action-card.tsx` — generic card shell
- New: `src/app/api/action-card/[id]/route.ts` — confirmation endpoint
- New: `src/lib/types/action-card.ts` — shared types
- Modify: `src/app/chat/chat-client.tsx` — parse and render cards
- Modify: `src/app/api/chat/route.ts` — emit card events in SSE stream

### 3. Workspace Directory Cache

Daily heartbeat sync of Slack users and channels into DB config.

**Data structure** (stored via config system as `slack:directory`):
```typescript
{
  users: [
    { id: "U12345", name: "harvy", realName: "Harvy Ruiz", displayName: "harvy", avatar: "https://...", deleted: false },
    ...
  ],
  channels: [
    { id: "C12345", name: "general", isPrivate: false, isMember: true },
    ...
  ],
  botUserId: "U99999",
  myUserId: "UMARK1",
  lastRefreshed: "2026-02-06T..."
}
```

**Sync strategy:**
- New heartbeat step: `syncSlackDirectory()`
- Paginate `users.list` (limit 200) — filter out deactivated and bots
- Paginate `conversations.list` (limit 200, `exclude_archived: true`)
- Capture `myUserId` via `auth.test`
- ~3-6 API calls total, well within Tier 2 rate limits
- Runs once per day (skip if `lastRefreshed` is < 24h)

**Resolution logic** (when agent says "DM harvy"):
1. Exact match on `displayName` or `name`
2. Fuzzy match on `realName` (case-insensitive, first name)
3. Ambiguous → agent asks "Did you mean Harvy Ruiz or Harvey Chen?"
4. No match → error to agent

**Files:**
- New: `src/lib/slack/directory.ts`
- Modify: `src/lib/memory/heartbeat.ts` — add sync step

### 4. Slack Sending Functions

Low-level functions that talk to the Slack API.

**Functions in `src/lib/slack/actions.ts`:**

```typescript
sendDirectMessage(recipientUserId, myUserId, message)
```
- Calls `conversations.open` with `[recipientUserId, myUserId]` to create/get group DM
- Calls `chat.postMessage` to the group DM channel
- Returns permalink

```typescript
sendChannelMessage(channelId, myUserId, message, threadTs?)
```
- Calls `chat.postMessage` to the channel
- Appends `cc <@myUserId>` mention
- Optionally replies to a thread via `thread_ts`
- Returns permalink

**Files:**
- New: `src/lib/slack/actions.ts`

### 5. Slack Agent Capability

Registered in the capability system so the AI can call it.

**Tool definition:**
```typescript
{
  name: "send_slack_message",
  description: "Draft a Slack message to a person or channel. Returns a card for user confirmation.",
  parameters: {
    to: "string — person name or #channel-name",
    message: "string — message content in Slack mrkdwn format",
    thread_ts: "string? — reply to a specific thread"
  }
}
```

**Routing:** `to` starting with `#` → channel lookup. Otherwise → user lookup.

**System prompt context:**
```
You can send Slack messages using send_slack_message.
- For DMs, use the person's first name (e.g., "harvy", "katie")
- For channels, use #channel-name (e.g., "#general", "#aurelius-hq")
- Messages use Slack mrkdwn format (*bold*, _italic_, `code`)
- Messages are always drafted for user approval — never sent automatically
- DMs are sent as group DMs that include Mark
- Channel posts include a @Mark mention
- Over time, use memory context to suggest appropriate recipients
```

**Handler flow:**
1. Resolve `to` against directory cache
2. Build Action Card payload with recipient details + message
3. Return card in SSE stream (never send directly)

**Files:**
- New: `src/lib/capabilities/slack/index.ts`
- Modify: `src/lib/capabilities/index.ts` — register in `ALL_CAPABILITIES`

### 6. Slack Message Card Variant

Specific Action Card implementation for Slack messages.

**Card data:**
```typescript
{
  cardType: "slack_message",
  status: "pending",
  data: {
    recipientType: "dm" | "channel",
    recipientId: "U12345",
    recipientName: "Harvy Ruiz",
    channelName: null,
    includeMe: true,
    message: "Hey Harvy...",
  },
  actions: ["send", "edit", "cancel"]
}
```

**Rendered fields:** To (name + avatar), Via (Group DM / #channel), Message body

**Actions:**
- **Send** → calls confirm endpoint → calls Slack sending functions → card updates to "Sent" with permalink
- **Edit** → inline editing of message body → Send
- **Cancel** → card status to "canceled", grayed out

**Files:**
- New: `src/components/aurelius/cards/slack-message-card.tsx`

## Build Order

| # | Piece | Deps | New Files | Modified Files |
|---|---|---|---|---|
| 1 | Markdown rendering | None | 0 | `chat-message.tsx`, `package.json` |
| 2 | Action Card system | None | 3 (`action-card.tsx`, API route, types) | `chat-client.tsx`, `route.ts` |
| 3 | Directory cache | None | 1 (`directory.ts`) | `heartbeat.ts` |
| 4 | Slack sending | 3 | 1 (`slack/actions.ts`) | — |
| 5 | Slack capability | 2, 3, 4 | 1 (`capabilities/slack/`) | `capabilities/index.ts` |
| 6 | Slack message card | 2, 4, 5 | 1 (`cards/slack-message-card.tsx`) | — |

Steps 1, 2, and 3 are independent and can be built in parallel.
Steps 4-6 are sequential and depend on earlier pieces.

## Future Extensions

- **Task cards** — Same Action Card system for creating/editing Linear tasks inline
- **Email draft cards** — Replace current Gmail draft flow with Action Cards
- **Confirmation toggle** — `SLACK_REQUIRE_CONFIRMATION=false` to skip the card and send directly
- **Memory-informed routing** — Agent learns "invoice payments → tell Harvy" over time through existing memory extraction
