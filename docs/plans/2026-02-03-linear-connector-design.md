# Linear Connector Design

**Date:** 2026-02-03
**Status:** Ready for implementation
**Branch:** `feature/linear-integration`

---

## Overview

The Linear connector pulls notifications into triage - assignments, @mentions, comments on your issues, and status changes on things you're watching. Linear remains the source of truth; Aurelius helps you prioritize and process.

This is the first phase of Linear integration. A future PM view will provide dedicated project/issue management using the same foundation.

## Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Auth | Personal API key | Simple, single-user, matches Aurelius pattern |
| Sync model | Notifications | Mirrors how you actually use Linear |
| Sync trigger | Heartbeat polling | Matches Gmail/Granola pattern, no webhooks needed |
| Actions | Archive only | Mark notification read; link to Linear for deeper actions |
| Memory | Manual only | High volume notifications, you pick what matters |
| Task extraction | None (manual) | Linear issues ARE tasks; avoid redundancy |

## Architecture

### Files

```
src/lib/linear/
├── client.ts      # GraphQL client, auth, core queries
├── sync.ts        # Fetch notifications → inbox_items
├── types.ts       # TypeScript types
└── index.ts       # Exports

src/app/api/linear/
└── sync/route.ts  # Manual sync endpoint

docs/connectors/linear.md  # Documentation
```

### Data Flow

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
│  2. For each notification, fetch issue details         │
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
│  Always shows "View in Linear" link                    │
└─────────────────────────────────────────────────────────┘
```

## Authentication

Personal API key stored in environment:

```bash
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
```

**How to get:**
1. Linear → Settings → Account → Security & Access
2. Create new API key with "Read" scope (Write for archive action)
3. Add to `.env.local`

## Content Mapping

### Triage Fields

| Triage Field | Linear Source | Notes |
|--------------|---------------|-------|
| `externalId` | Notification ID | Deduplication key |
| `connector` | `'linear'` | |
| `sender` | Actor email or ID | Who triggered notification |
| `senderName` | Actor displayName | |
| `senderAvatar` | Actor avatarUrl | Linear provides this |
| `subject` | `{identifier}: {title}` | e.g., "ENG-123: Fix login bug" |
| `content` | Context-dependent | Comment body, status change, etc. |
| `preview` | Issue description | First ~200 chars |
| `receivedAt` | Notification createdAt | |
| `rawPayload` | Full notification + issue | For future PM view |

### Enrichment Fields

```typescript
interface LinearEnrichment {
  // Notification context
  notificationType:
    | 'issueAssignment'
    | 'issueMention'
    | 'issueComment'
    | 'issueStatusChanged'
    | 'issuePriorityChanged'
    | 'issueNewComment'
    | 'issueSubscription'
    | 'other';

  // Issue details
  issueState: string;           // "In Progress", "Done", etc.
  issueStateType: string;       // "started", "completed", etc.
  issuePriority: number;        // 0=none, 1=urgent, 2=high, 3=normal, 4=low
  issueProject?: string;        // Project name if assigned
  issueLabels: string[];        // Label names

  // Actor
  actor?: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  };

  // Links
  linearUrl: string;            // Direct link to issue

  // Standard enrichment
  summary?: string;             // AI-generated summary
  linkedEntities?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}
```

## Notification Types

Linear's notification types we'll handle:

| Type | Description | Content |
|------|-------------|---------|
| `issueAssignedToYou` | Issue assigned to you | Issue title + description |
| `issueMention` | @mentioned in issue/comment | Context around mention |
| `issueNewComment` | New comment on your issue | Comment body |
| `issueStatusChanged` | Status changed on watched issue | Old → New state |
| `issuePriorityChanged` | Priority changed | Old → New priority |
| `projectUpdateMention` | Mentioned in project update | Update excerpt |

## Actions

### Archive (Primary)
- Marks notification as read in Linear
- Removes from triage inbox
- Uses `notificationArchive` mutation

### View in Linear (Always Available)
- Opens `linearUrl` in browser
- For deeper actions (status change, comment, assign, etc.)

## GraphQL Queries

### Fetch Notifications

```graphql
query Notifications($after: String) {
  notifications(first: 50, after: $after) {
    nodes {
      id
      type
      createdAt
      readAt
      archivedAt
      actor {
        id
        name
        email
        avatarUrl
      }
      issue {
        id
        identifier
        title
        description
        url
        state {
          id
          name
          type
        }
        priority
        project {
          id
          name
        }
        labels {
          nodes {
            id
            name
          }
        }
      }
      comment {
        id
        body
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Archive Notification

```graphql
mutation ArchiveNotification($id: String!) {
  notificationArchive(id: $id) {
    success
  }
}
```

## Sync Logic

```typescript
async function syncLinearNotifications(): Promise<LinearSyncResult> {
  // 1. Check if configured
  if (!isConfigured()) {
    return { synced: 0, skipped: 0, error: 'Not configured' };
  }

  // 2. Fetch unread/unarchived notifications
  const notifications = await fetchNotifications();

  // 3. For each notification
  let synced = 0;
  let skipped = 0;

  for (const notif of notifications) {
    // Skip if already in triage
    if (await notificationExists(notif.id)) {
      skipped++;
      continue;
    }

    // Skip if no associated issue (rare)
    if (!notif.issue) {
      skipped++;
      continue;
    }

    // Map to inbox item
    const item = mapNotificationToInboxItem(notif);

    // Insert (no task extraction)
    await db.insert(inboxItems).values(item);
    synced++;
  }

  return { synced, skipped };
}
```

## Configuration

### Environment Variables

```bash
# Required
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx

# Optional (future)
LINEAR_TEAM_FILTER=team-uuid      # Only sync from specific team
LINEAR_SYNC_DAYS=7                # How far back on first sync
```

### Heartbeat Integration

Add to `heartbeat.ts`:

```typescript
// Step N: Sync Linear notifications
let linearResult: LinearSyncResult | undefined;
if (!options.skipLinear) {
  const linearStart = Date.now();
  try {
    linearResult = await syncLinearNotifications();
    if (linearResult.synced > 0) {
      console.log(`[Heartbeat] Linear: synced ${linearResult.synced} notifications`);
    }
    steps.linear = {
      success: true,
      durationMs: Date.now() - linearStart,
    };
  } catch (error) {
    // ... error handling
  }
}
```

## UI Integration

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

### Tags

Smart tags based on notification/issue:

| Tag | Condition |
|-----|-----------|
| `Urgent` | Priority = 1 |
| `High` | Priority = 2 |
| `Assigned` | You're the assignee |
| `Mentioned` | @mentioned |
| `Bug` | Has "bug" label |
| `{Project}` | Project name if assigned |

## Implementation Checklist

### Phase 1: Core Connector
- [ ] Create `src/lib/linear/types.ts` - TypeScript types
- [ ] Create `src/lib/linear/client.ts` - GraphQL client, auth
- [ ] Create `src/lib/linear/sync.ts` - Notification sync
- [ ] Create `src/lib/linear/index.ts` - Exports
- [ ] Create `src/app/api/linear/sync/route.ts` - Manual sync endpoint
- [ ] Add to heartbeat
- [ ] Test with real Linear account

### Phase 2: Actions
- [ ] Implement archive action (mark notification read)
- [ ] Add "View in Linear" action
- [ ] Wire up to triage UI

### Phase 3: Documentation
- [ ] Create `docs/connectors/linear.md`
- [ ] Update `docs/connectors/index.md`

### Future: PM View
- [ ] Dedicated issues page
- [ ] Full issue CRUD (status, priority, assignee)
- [ ] Project/cycle views
- [ ] Uses `rawPayload` data from synced items

## Dependencies

- Existing: `inboxItems` schema, heartbeat system, triage UI
- New: None (Linear API is GraphQL, can use fetch)
- Optional: `@linear/sdk` npm package (but raw GraphQL is fine)

## Testing

```typescript
// src/lib/linear/__tests__/sync.test.ts

describe('Linear Sync', () => {
  it('maps notification to inbox item correctly', () => {
    const notif = mockNotification({ type: 'issueAssignedToYou' });
    const item = mapNotificationToInboxItem(notif);

    expect(item.connector).toBe('linear');
    expect(item.subject).toBe('ENG-123: Test issue');
    expect(item.enrichment.notificationType).toBe('issueAssignment');
  });

  it('skips already-synced notifications', async () => {
    // Insert existing
    await db.insert(inboxItems).values({ externalId: 'notif-1', ... });

    // Sync should skip
    const result = await syncLinearNotifications();
    expect(result.skipped).toBe(1);
  });

  it('extracts enrichment fields correctly', () => {
    const notif = mockNotification({
      issue: {
        priority: 2,
        state: { name: 'In Progress', type: 'started' },
        labels: [{ name: 'bug' }, { name: 'mobile' }],
      }
    });

    const item = mapNotificationToInboxItem(notif);

    expect(item.enrichment.issuePriority).toBe(2);
    expect(item.enrichment.issueState).toBe('In Progress');
    expect(item.enrichment.issueLabels).toEqual(['bug', 'mobile']);
  });
});
```

## MCP Server Note

Linear has MCP tools available (`mcp__linear__*`) which could be used for the future PM view. For the connector, we'll use direct GraphQL for simplicity and to match the Gmail/Granola pattern.
