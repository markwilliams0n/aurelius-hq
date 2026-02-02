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
| **Status** | Stub (fake data only) |
| **Added** | 2026-02-01 |
| **Description** | Email messages from Gmail |
| **Documentation** | None yet |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | Yes | Direct email reply |
| Archive | Yes | |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | No | |
| Task Extraction | Yes | AI extraction |

**Custom Enrichment Fields:** None

**Sync:** Not implemented (using fake data)

**Files:** None yet (uses fake data generator)

---

### slack
| Property | Value |
|----------|-------|
| **Status** | Stub (fake data only) |
| **Added** | 2026-02-01 |
| **Description** | Channel messages from Slack |
| **Documentation** | None yet |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | Yes | Thread reply |
| Archive | Yes | |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | No | |
| Task Extraction | Yes | AI extraction |

**Custom Enrichment Fields:** None

**Sync:** Not implemented (using fake data)

**Files:** None yet (uses fake data generator)

---

### linear
| Property | Value |
|----------|-------|
| **Status** | Stub (fake data only) |
| **Added** | 2026-02-01 |
| **Description** | Issues from Linear |
| **Documentation** | None yet |

**Capabilities:**
| Feature | Supported | Notes |
|---------|-----------|-------|
| Reply | No | Use Linear UI for comments |
| Archive | Yes | |
| Memory | Yes | Manual only |
| Chat | Yes | |
| Custom Actions | No | Could add: change status, assign |
| Task Extraction | Yes | AI extraction |

**Custom Enrichment Fields:** None (could add: `issueState`, `assignee`, `project`, `cycle`)

**Sync:** Not implemented (using fake data)

**Files:** None yet (uses fake data generator)

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
| gmail | Yes | No | No | AI only | Stub |
| slack | Yes | No | No | AI only | Stub |
| linear | No | No | No | AI only | Stub |
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

### Planned
- [ ] **Gmail** - Full implementation with OAuth
- [ ] **Slack** - Full implementation with OAuth
- [ ] **Linear** - Full implementation with API key
- [ ] **Notion** - Database items and pages
- [ ] **Calendar** - Google/Outlook calendar events

### Under Consideration
- Asana - Task management
- Jira - Issue tracking
- GitHub - Issues and PRs
- Obsidian - Local markdown notes
- Telegram - Messages (already have bot setup)
