# Slack Connector

Real-time Slack integration via Socket Mode. Captures DMs, @mentions, and messages from a designated triage channel for processing in Aurelius.

## Overview

| Property | Value |
|----------|-------|
| Connector ID | `slack` |
| Status | **Active** |
| Authentication | Bot Token + App Token (Socket Mode) |
| Supports Reply | Yes (thread reply) |
| Supports Archive | Yes |
| Custom Enrichment | Yes |
| Auto Memory Extraction | No (manual only) |
| Task Extraction | Yes (AI + user instructions) |

## Core Workflow

```
┌─────────────────────────────────────────────────────────┐
│              SOCKET MODE (Real-time)                    │
│         Persistent WebSocket connection                 │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│     DMs      │ │  @mentions   │ │ Triage Chan  │
│  to the bot  │ │  anywhere    │ │ #aurelius-hq │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   PROCESSING                            │
│  1. Detect message type (DM, mention, thread)           │
│  2. Fetch full thread if @mentioned in thread           │
│  3. Generate AI summary via Ollama                      │
│  4. Extract suggested tasks                             │
│  5. Insert to inbox_items                               │
│  6. React with 👀 to acknowledge                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    TRIAGE                               │
│  User processes messages with keyboard shortcuts        │
│  Tasks default to "For You" (self)                      │
└─────────────────────────────────────────────────────────┘
```

## Authentication

Uses **Socket Mode** for real-time events (no public webhook URL needed):

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode in app settings
3. Generate App-Level Token with `connections:write` scope
4. Add Bot Token Scopes (see below)
5. Install app to workspace
6. Invite bot to triage channel

**Required Bot Token Scopes:**
- `channels:history` - Read channel messages
- `channels:read` - List channels (to resolve triage channel)
- `channels:join` - Join public channels
- `groups:history` - Read private channel messages
- `groups:read` - List private channels
- `im:history` - Read DM history
- `im:read` - Access DMs
- `im:write` - Send DM replies
- `reactions:read` - Read reactions
- `reactions:write` - Add reactions (👀 acknowledgment)
- `users.profile:read` - Get user display names
- `files:read` - Access shared files

**Event Subscriptions:**
- `message.channels` - Channel messages
- `message.groups` - Private channel messages
- `message.im` - Direct messages
- `app_mention` - @mentions of the bot

**Environment variables:**
```bash
SLACK_BOT_TOKEN=xoxb-...      # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...      # App-Level Token (Socket Mode)
SLACK_TRIAGE_CHANNEL=aurelius-hq  # Channel name or ID
```

## Message Capture

### Triage Channel
All messages in the designated channel are captured automatically (no @mention needed).

### Direct Messages
All DMs to the bot are captured.

### @Mentions
When @mentioned anywhere:
- **Single message**: Captures just the message
- **In a thread**: Captures the **entire thread** with all participants

### User Instructions
Users can give explicit instructions:
```
@aurelius make a task to review the Q1 budget
@aurelius add this to my tasks
@aurelius remind me to follow up with Sarah
```

The instruction is prepended to the content as `USER INSTRUCTION:` so AI task extraction picks it up.

## Content Mapping

| Triage Field | Slack Source | Notes |
|--------------|--------------|-------|
| `externalId` | `{channelId}:{messageTs}` | Deduplication |
| `sender` | User ID | Slack user ID |
| `senderName` | User real name | Fetched from Slack API |
| `senderAvatar` | Profile image | 72px avatar |
| `subject` | Generated | Based on context (see below) |
| `content` | Message text | Full thread if applicable |
| `preview` | First 200 chars | |
| `receivedAt` | Message timestamp | |
| `tags` | Auto-generated | Thread, Forwarded, DM |

### Subject Generation

| Context | Subject Format |
|---------|----------------|
| DM | `DM from {name}` |
| Channel message | `#{channel}: {name}` |
| Thread capture | `Thread: {participant1}, {participant2}, +N` |
| Forwarded | `Slack from {originalSender}` |

## AI Enrichment

### Summary (via Ollama)
Local LLM generates 1-3 sentence summary capturing:
- Main topic or purpose
- Key decisions or asks
- Who needs to do what

Requires Ollama running locally with `llama3.2:3b` model.

### Custom Enrichment Fields

| Field | Description |
|-------|-------------|
| `messageType` | `direct_message` or `direct_mention` |
| `channelId` | Slack channel ID |
| `channelName` | Channel name |
| `threadTs` | Thread timestamp (if in thread) |
| `slackUrl` | Permalink to message |
| `isThread` | Whether this is a thread capture |
| `threadParticipants` | Names of thread participants |
| `isForwarded` | Whether message was forwarded |
| `forwardedBy` | Who forwarded the message |
| `summary` | AI-generated summary |

## Task Extraction

Tasks are extracted using the standard AI extraction system with `defaultToSelf: true`:

- Tasks default to **"For You"** (self) unless explicitly assigned to someone else
- User instructions like "@aurelius make a task to..." are detected and extracted
- Thread context helps AI understand task scope

## Actions

### Archive
- Marks as archived in triage
- Removes 👀 reaction (future enhancement)

### Reply
- Replies in thread to the original message
- Maintains conversation context

### Memory
- Manual extraction to memory system
- Press `↑` to extract entities and facts

## Sync Behavior

### Real-time (Socket Mode)
- **Primary method**: Persistent WebSocket connection
- **Started by**: Heartbeat or manual API call
- **No polling needed**: Events pushed instantly
- **Auto-reconnect**: SDK handles connection drops

### Fallback Sync
- **API endpoint**: `POST /api/slack/sync`
- **Uses**: Search API to find messages mentioning bot
- **Trigger**: Manual or if Socket Mode unavailable

### Socket Status
- **Check**: `GET /api/slack/socket`
- **Start**: `POST /api/slack/socket`
- **Stop**: `DELETE /api/slack/socket`

## Configuration

### Environment Variables

```bash
# Required
SLACK_BOT_TOKEN=xoxb-...           # Bot token
SLACK_APP_TOKEN=xapp-...           # App token for Socket Mode

# Optional
SLACK_TRIAGE_CHANNEL=aurelius-hq   # Auto-capture channel
SLACK_USER_TOKEN=xoxp-...          # User token (for search API)
```

### App Manifest

See `docs/slack-app-manifest.yml` for complete app configuration.

## Files

| File | Purpose |
|------|---------|
| `src/lib/slack/socket.ts` | Socket Mode listener, event handlers |
| `src/lib/slack/client.ts` | Web API client, user/channel info |
| `src/lib/slack/sync.ts` | Fallback sync via search API |
| `src/lib/slack/types.ts` | TypeScript types |
| `src/lib/slack/index.ts` | Public exports |
| `src/app/api/slack/socket/route.ts` | Socket control API |
| `src/app/api/slack/sync/route.ts` | Manual sync API |
| `docs/slack-app-manifest.yml` | App configuration reference |

## UI Elements

### Card Display
- Sender avatar
- Sender name
- Subject (context-aware)
- Preview snippet
- Tags (Thread, DM, Forwarded)

### Detail View
- Full message/thread content
- AI summary
- Thread participants (if thread)
- Suggested tasks
- "View in Slack" link

## Implementation Status

### Core Features
- [x] Socket Mode real-time connection
- [x] DM capture
- [x] @mention capture
- [x] Triage channel capture
- [x] Full thread capture
- [x] Deduplication by externalId
- [x] 👀 reaction acknowledgment

### AI Features
- [x] Ollama summary generation
- [x] Task extraction with defaultToSelf
- [x] User instruction detection
- [ ] Memory auto-extraction (manual only)

### Actions
- [x] Archive
- [ ] Reply (thread reply)
- [ ] View in Slack link

### Future Enhancements
- [ ] Bi-directional archive sync
- [ ] Reaction-based quick actions
- [ ] File/attachment handling
- [ ] Slack Connect (external channels)
