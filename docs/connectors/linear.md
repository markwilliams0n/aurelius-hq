# Linear Connector

Linear integration for notification-based triage. Syncs your notifications into triage inbox, enabling fast processing while Linear remains the source of truth.

## Overview

| Property | Value |
|----------|-------|
| Connector ID | `linear` |
| Status | **Active** |
| Authentication | Personal API key |
| Supports Reply | No (use Linear UI) |
| Supports Archive | Yes (marks notification as read) |
| Custom Enrichment | Yes |
| Auto Memory Extraction | No (manual only) |
| Task Extraction | No (Linear issues are tasks) |

## Core Workflow

```
┌─────────────────────────────────────────────────────────┐
│                    HEARTBEAT                            │
│              (triggers all syncs)                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  LINEAR SYNC                            │
│  1. Fetch unread notifications via GraphQL             │
│  2. For each notification, include issue details       │
│  3. Dedupe by notification ID (skip already-triaged)   │
│  4. Map to inbox_items with enrichment                 │
│  5. Insert to database                                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    TRIAGE                               │
│  User processes notifications with keyboard shortcuts  │
│  Archive → marks notification read in Linear           │
│  "View in Linear" link always available                │
└─────────────────────────────────────────────────────────┘
```

## Authentication

Uses **Personal API key**:

1. Linear → Settings → Account → Security & Access
2. Create new API key with "Read" and "Write" scopes
3. Add to `.env.local`

**Environment variables:**
```bash
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
```

## Content Mapping

| Triage Field | Linear Source | Notes |
|--------------|---------------|-------|
| `externalId` | Notification ID | Deduplication |
| `sender` | Actor email/name | Who triggered |
| `senderName` | Actor display name | |
| `senderAvatar` | Actor avatar URL | Linear provides this |
| `subject` | `{identifier}: {title}` | e.g., "ENG-123: Fix login bug" |
| `content` | Issue description + comment | Context-dependent |
| `preview` | Issue description snippet | First ~200 chars |
| `receivedAt` | Notification createdAt | |
| `rawPayload` | Full notification + issue | For future PM view |

## Notification Types

| Type | Description | Content |
|------|-------------|---------|
| `issueAssignedToYou` | Issue assigned to you | Issue title + description |
| `issueMention` | @mentioned in issue/comment | Context around mention |
| `issueNewComment` | New comment on your issue | Comment body |
| `issueStatusChanged` | Status changed on watched issue | Old → New state |
| `issuePriorityChanged` | Priority changed | Old → New priority |
| `projectUpdateMention` | Mentioned in project update | Update excerpt |

## Custom Enrichment Fields

| Field | Description |
|-------|-------------|
| `notificationType` | What triggered: assignment, mention, comment, etc. |
| `issueState` | Current status (In Progress, Done, etc.) |
| `issueStateType` | Status category (started, completed, etc.) |
| `issuePriority` | Priority level (0-4) |
| `issueProject` | Project name if assigned |
| `issueLabels` | Array of label names |
| `actor` | Who triggered (name, email, avatar) |
| `linearUrl` | Direct link to issue |

## Keyboard Shortcuts

| Key | Action | Notes |
|-----|--------|-------|
| `←` | Archive | Marks notification as read in Linear |
| `↑` | Memory | Extract to memory (manual) |
| `→` | Actions | Opens action palette |
| `↓` | Chat | Chat about this notification |

## Actions

### Archive
- Marks notification as read in Linear
- Removes from triage inbox
- Uses `notificationArchive` GraphQL mutation

### View in Linear
- Opens `linearUrl` in browser
- For deeper actions (status change, comment, assign, etc.)

## Smart Tags

Auto-applied based on notification/issue:

| Tag | Condition |
|-----|-----------|
| `Urgent` | Priority = 1 |
| `High` | Priority = 2 |
| `Assigned` | You're the assignee |
| `Mentioned` | @mentioned |
| `Bug` | Has "bug" label |
| `Feature` | Has "feature" label |
| `{Project}` | Project name if assigned |

## Sync Behavior

- **Trigger**: Heartbeat (default 15 min, configurable)
- **Query**: Unread/unarchived notifications
- **Deduplication**: By notification ID
- **Limit**: Max 200 notifications per sync (safety)
- **State**: Tracks last sync time in configs table

## Configuration

### Environment Variables

```bash
# Required
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
```

### App Settings

- Heartbeat interval (affects all syncs)

## Files

| File | Purpose |
|------|---------|
| `src/lib/linear/client.ts` | GraphQL client, auth, queries |
| `src/lib/linear/sync.ts` | Notification sync logic |
| `src/lib/linear/types.ts` | TypeScript types |
| `src/lib/linear/index.ts` | Exports |
| `src/app/api/linear/sync/route.ts` | Manual sync endpoint |

## UI Elements

### Card Display
```
┌──────────────────────────────────────────────┐
│ 🔷 Linear · issueAssignment                   │
│ Sarah Chen assigned you                       │
├──────────────────────────────────────────────┤
│ ENG-123: Fix login redirect bug              │
│                                              │
│ Users are getting stuck in a redirect loop   │
│ when trying to log in from mobile...         │
│                                              │
│ ⚡ High · API Team · bug, mobile             │
├──────────────────────────────────────────────┤
│  ← Archive   ↑ Memory   → Actions   ↓ Chat   │
│                         └─ View in Linear    │
└──────────────────────────────────────────────┘
```

### Action Palette (→)
- View in Linear

## Future: PM View

This connector is designed with a future PM view in mind:
- `rawPayload` stores full issue data for richer display
- Issue state/priority/labels available for filtering
- Foundation for bidirectional status updates
- Could add: status changes, comments, assignments directly from Aurelius

## Implementation Status

### Core Sync ✅
- [x] API key authentication
- [x] Fetch unread notifications
- [x] Content mapping + deduplication
- [x] Insert to inbox_items
- [x] Heartbeat integration

### Enrichment ✅
- [x] Notification type extraction
- [x] Issue state/priority/project/labels
- [x] Actor information
- [x] Smart tags (Urgent, High, Assigned, etc.)

### Actions
- [x] Archive (mark notification read)
- [x] View in Linear link (via enrichment.linearUrl)

### Future Enhancements
- [ ] Status change actions
- [ ] Comment from triage
- [ ] Dedicated PM view
- [ ] Project/cycle filtering
