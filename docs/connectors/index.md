# Connector Registry

Central reference for all triage connectors, their capabilities, and status.

## Active Connectors

### granola
| Property | Value |
|----------|-------|
| **Status** | Active |
| **Added** | 2026-02-02 |
| **Description** | AI meeting notes from Granola app |
| **Documentation** | [granola.md](./granola.md) |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | No | Meetings don't have replies |
| Archive | Yes | |
| Memory | Yes | **Auto-extract** during sync |
| Chat | Yes | |
| Custom Actions | No | |
| Task Extraction | Yes | Uses Granola's action items + AI |

**Custom Enrichment Fields:**
- `attendees` - Meeting participants
- `meetingTime` - Formatted meeting time
- `topics` - Discussion topics
- `actionItems` - Granola-extracted action items
- `extractedMemory` - AI-extracted entities, facts, tasks

**Sync:**
- Trigger: Manual (`/api/granola/sync`)
- Window: Last 30 days by default
- Deduplication: By `externalId` (Granola document ID)
- Auto-saves memory during sync

**Files:**
- `src/lib/granola/client.ts`
- `src/lib/granola/sync.ts`
- `src/lib/granola/extract-memory.ts`
- `src/app/api/granola/sync/route.ts`

---

### gmail
| Property | Value |
|----------|-------|
| **Status** | **Active** |
| **Added** | 2026-02-01 |
| **Description** | Email messages from Gmail (Workspace) |
| **Documentation** | [gmail.md](./gmail.md) |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | Yes | Drafts initially, direct send via setting |
| Archive | Yes | **Bi-directional** - syncs back to Gmail |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | Yes | Unsubscribe, Spam, Always Archive, To Action |
| Task Extraction | Yes | AI extraction |

**Custom Enrichment Fields:**
- `intent` - What sender wants (FYI, needs response, action required)
- `deadline` - Mentioned deadlines/time sensitivity
- `sentiment` - Email tone (urgent, friendly, formal, frustrated)
- `threadSummary` - Summary of full thread context
- Smart sender tags: Internal, New, Direct, CC'd, VIP, Auto, Newsletter, Suspicious

**Sync:**
- Trigger: Heartbeat (centralized, default 15 min)
- Query: All unarchived Gmail emails
- Deduplication: By thread ID
- Bi-directional: Archive/spam sync back to Gmail
- Threading: Latest message creates item, history collapsed

**Files:**
- `src/lib/gmail/client.ts`
- `src/lib/gmail/sync.ts`
- `src/lib/gmail/actions.ts`
- `src/lib/gmail/types.ts`
- `src/app/api/gmail/sync/route.ts`
- `src/app/api/gmail/reply/route.ts`

---

### slack
| Property | Value |
|----------|-------|
| **Status** | **Active** |
| **Added** | 2026-02-05 |
| **Description** | Real-time messages via Socket Mode |
| **Documentation** | [slack.md](./slack.md) |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | Yes | Thread reply |
| Archive | Yes | |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | No | |
| Task Extraction | Yes | AI + user instructions, defaults to self |

**Custom Enrichment Fields:**
- `messageType` - DM or mention
- `channelName` - Source channel
- `threadParticipants` - Thread participant names
- `isThread` - Whether full thread captured
- `summary` - AI-generated summary (Ollama)
- `slackUrl` - Permalink to message

**Sync:**
- Primary: Socket Mode (real-time WebSocket)
- Fallback: Search API sync
- Deduplication: By `externalId` (channelId:messageTs)

**Files:**
- `src/lib/slack/socket.ts` - Socket Mode listener
- `src/lib/slack/client.ts` - Web API client
- `src/lib/slack/sync.ts` - Fallback sync
- `src/lib/slack/types.ts` - TypeScript types
- `src/app/api/slack/socket/route.ts` - Socket control
- `src/app/api/slack/sync/route.ts` - Manual sync

---

### linear
| Property | Value |
|----------|-------|
| **Status** | **Active** |
| **Added** | 2026-02-03 |
| **Description** | Notifications from Linear |
| **Documentation** | [linear.md](./linear.md) |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | No | Use Linear UI for comments |
| Archive | Yes | Marks notification as read |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | Yes | View in Linear link |
| Task Extraction | No | Linear issues are tasks |

**Custom Enrichment Fields:**
- `notificationType` - Assignment, mention, comment, status change
- `issueState` - Current issue status
- `issuePriority` - Priority level (0-4)
- `issueProject` - Project name
- `issueLabels` - Label names
- `actor` - Who triggered the notification
- `linearUrl` - Direct link to issue

**Sync:**
- Trigger: Heartbeat (centralized, default 15 min)
- Query: Unread notifications
- Deduplication: By notification ID

**Files:**
- `src/lib/linear/client.ts`
- `src/lib/linear/sync.ts`
- `src/lib/linear/types.ts`
- `src/app/api/linear/sync/route.ts`

---

### manual
| Property | Value |
|----------|-------|
| **Status** | Active |
| **Added** | 2026-02-01 |
| **Description** | Manually created triage items |
| **Documentation** | None |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | No | |
| Archive | Yes | |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | No | |
| Task Extraction | Yes | AI extraction |

**Custom Enrichment Fields:** None

**Sync:** N/A (created via API or UI)

**Files:** N/A

---

## Capability Matrix

| Connector | Reply | Auto Memory | Custom Enrichment | Task Source | Status |
|-----------|-------|-------------|-------------------|-------------|--------|
| granola | No | Yes | Yes | Granola + AI | Active |
| gmail | Yes | No | Yes | AI | **Active** |
| slack | Yes | No | Yes | AI + instructions | **Active** |
| linear | No | No | Yes | None (issues are tasks) | **Active** |
| manual | No | No | No | AI only | Active |

## Adding New Connectors

See [README.md](./README.md) for the connector setup wizard.

When adding a new connector:
1. Add entry to `connectorTypeEnum` in `src/lib/db/schema/triage.ts`
2. Add to `CONNECTOR_ACTIONS` in `src/app/triage/triage-client.tsx`
3. Create connector files in `src/lib/{connector}/`
4. Create API routes in `src/app/api/{connector}/`
5. Add documentation in `docs/connectors/{connector}.md`
6. **Update this registry**

## Connector Roadmap

### Recently Completed
- [x] **Gmail** - Full implementation with Service Account auth, phishing detection, bi-directional sync ([docs](./gmail.md))
- [x] **Linear** - Notification sync with API key auth, enrichment, archive action ([docs](./linear.md))
- [x] **Slack** - Real-time Socket Mode, thread capture, Ollama summaries, task extraction ([docs](./slack.md))

### Planned
- [ ] **Notion** - Database items and pages
- [ ] **Calendar** - Google/Outlook calendar events

### Under Consideration
- Asana - Task management
- Jira - Issue tracking
- GitHub - Issues and PRs
- Obsidian - Local markdown notes
- Telegram - Messages (already have bot setup)

## Cross-Connector Features

Features that apply to all connectors:

### Style Guides
Per-connector AI guidance for tone, formality, reply style. Chat-updatable.

### Connector Rules
Per-connector triage rules for auto-actions (archive, priority, tags).

### Heartbeat
Central scheduler triggers all syncs (default 15 min, configurable in settings).
