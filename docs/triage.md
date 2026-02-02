# Triage System

The triage system is a unified inbox for processing items from multiple sources (connectors). Items flow in, get enriched with AI analysis and memory context, and are processed through keyboard-driven workflows.

## Core Concepts

### Inbox Items

Every item in triage has:
- **Source connector** - Where it came from (gmail, slack, linear, granola, manual)
- **Core content** - Subject, body, sender info
- **Status** - new, archived, snoozed, actioned
- **Priority** - urgent, high, normal, low
- **Tags** - User-applied labels
- **Enrichment** - AI-generated analysis and memory links

### Item Lifecycle

```
┌─────────────┐
│   Source    │  Gmail, Slack, Linear, Granola, etc.
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Ingest    │  Connector syncs item to inbox_items table
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Enrich    │  AI analysis, memory linking, task extraction
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Triage    │  User reviews and takes action
└──────┬──────┘
       │
       ├──► Archive (←) - Done, no action needed
       ├──► Memory (↑) - Save facts to memory
       ├──► Snooze (s) - Hide until later
       ├──► Actions (→) - Take specific actions
       └──► Reply (↓) - Respond directly

```

## Keyboard Shortcuts

| Key | Action | Description |
|-----|--------|-------------|
| `←` | Archive | Mark as done, remove from queue |
| `↑` | Memory | Extract and save facts to memory |
| `⇧↑` | Memory + Archive | Save to memory then archive |
| `s` | Snooze | Hide until selected time |
| `␣` (Space) | Chat | Open AI chat about this item |
| `↵` (Enter) | Expand | View full item details |
| `→` | Actions | Open action menu |
| `↓` | Reply | Compose reply (if supported) |
| `Esc` | Close | Close any overlay |

## Snooze Options

Snooze hides an item until a specified time:
- **1 hour** - Quick delay
- **3 hours** - Later today
- **Tomorrow 9 AM** - Next morning
- **Next Monday 9 AM** - Start of next week
- **First of next month** - Monthly items

Snoozed items automatically return to "new" status when their snooze time passes.

## Suggested Tasks

When items are ingested, AI extracts potential action items:
- **For You** - Tasks assigned to you (based on soul.md identity)
- **For Others** - Tasks for other people mentioned

Tasks can be:
- **Accepted** (✓) - Creates a memory fact about the commitment
- **Dismissed** (✗) - Removes from suggestions

Archiving an item automatically dismisses any remaining suggested tasks.

## Enrichment

Each item can be enriched with:

### Standard Enrichment
- `summary` - AI-generated summary
- `suggestedPriority` - Recommended priority level
- `suggestedTags` - Recommended tags
- `linkedEntities` - People, companies, projects from memory
- `suggestedActions` - Recommended next steps
- `contextFromMemory` - Relevant context from memory

### Connector-Specific Enrichment
Different connectors can add their own enrichment fields. See [Connectors](./connectors/) for details.

## Database Schema

### inbox_items
Main triage table storing all items.

```sql
inbox_items (
  id UUID PRIMARY KEY,
  connector connector_type NOT NULL,  -- gmail, slack, linear, granola, manual
  external_id TEXT,                    -- ID in source system
  sender TEXT NOT NULL,
  sender_name TEXT,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  status inbox_status DEFAULT 'new',   -- new, archived, snoozed, actioned
  snoozed_until TIMESTAMP,
  priority priority DEFAULT 'normal',
  tags TEXT[],
  enrichment JSONB,
  received_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### suggested_tasks
Tasks extracted from items.

```sql
suggested_tasks (
  id UUID PRIMARY KEY,
  source_item_id UUID REFERENCES inbox_items(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  assignee TEXT,
  assignee_type assignee_type DEFAULT 'unknown',  -- self, other, unknown
  due_date TEXT,
  status task_status DEFAULT 'suggested',  -- suggested, accepted, dismissed
  confidence confidence DEFAULT 'medium',
  extracted_at TIMESTAMP,
  resolved_at TIMESTAMP
)
```

## API Endpoints

### GET /api/triage
List triage items. Automatically wakes up expired snoozed items.

Query params:
- `status` - Filter by status (default: "new")
- `connector` - Filter by connector
- `limit` - Max items to return

### POST /api/triage/[id]
Perform action on item.

Actions:
- `archive` - Mark as archived
- `snooze` - Snooze with `snoozeUntil` (ISO string) or `duration`
- `actioned` - Mark as actioned
- `restore` - Return to new status
- `flag` - Toggle flagged tag
- `priority` - Set priority
- `tag` - Add tag

### POST /api/triage/[id]/memory
Extract and save facts to memory.

### GET/POST /api/triage/[id]/tasks
Get suggested tasks or accept/dismiss them.

### DELETE /api/triage/[id]/tasks
Dismiss all remaining suggested tasks.

## Connector Integration

Each connector must:
1. Sync items to `inbox_items` table
2. Optionally provide custom enrichment
3. Optionally support custom actions

See [Connector Setup Guide](./connectors/README.md) for creating new connectors.
