# Connector Setup Guide

This guide walks through the design decisions needed when creating a new connector for the triage system.

## Connector Interview

When setting up a new connector, work through these questions:

### 1. Basic Information

```
Connector name: _______________
Connector ID (lowercase, no spaces): _______________
What does this connector sync? _______________
```

### 2. Data Source

```
[ ] External API (Gmail, Slack, Linear, etc.)
[ ] Local app (Granola, etc.)
[ ] Manual entry
[ ] Webhook-triggered

API base URL: _______________
Authentication method:
  [ ] API key
  [ ] OAuth
  [ ] Personal token
  [ ] None
```

### 3. Content Mapping

Map source fields to inbox item fields:

| Inbox Field | Source Field | Notes |
|-------------|--------------|-------|
| `externalId` | | Unique ID in source system |
| `sender` | | Who created/sent this |
| `senderName` | | Display name |
| `senderAvatar` | | Avatar URL (optional) |
| `subject` | | Title/subject line |
| `content` | | Main body text |
| `preview` | | Short preview (optional) |
| `receivedAt` | | When item was created/received |

### 4. Supported Actions

Which triage actions should this connector support?

```
[x] Archive - Always supported
[ ] Reply - Can respond directly to source
[ ] Custom actions - Connector-specific actions

If Reply supported:
  - How to send reply: _______________
  - Reply format: _______________

If Custom actions:
  - Action 1: _______________
  - Action 2: _______________
```

### 5. AI Enrichment

What AI analysis should run on items from this connector?

```
Standard enrichment (always included):
[x] Summary generation
[x] Priority suggestion
[x] Tag suggestions
[x] Entity linking (to memory)
[x] Context from memory

Custom enrichment for this connector:
[ ] _______________
[ ] _______________
[ ] _______________
```

**Example custom enrichment:**
- Granola: `attendees`, `meetingTime`, `topics`, `actionItems`
- Gmail: `threadId`, `labels`, `attachments`
- Linear: `issueState`, `assignee`, `project`, `cycle`

### 6. Memory Integration

How should this connector interact with memory?

```
[ ] Auto-extract memory during sync (like Granola)
[ ] Manual memory extraction only (user presses ↑)
[ ] No memory integration

If auto-extract:
  - What entities to extract: _______________
  - What facts to extract: _______________
```

### 7. Task Extraction

Should AI extract suggested tasks from items?

```
[ ] Yes - Extract action items/tasks
[ ] No - No task extraction

If yes:
  - Source already provides tasks? [ ] Yes [ ] No
  - If yes, field name: _______________
  - AI should supplement? [ ] Yes [ ] No
```

### 8. Sync Behavior

How should items be synced?

```
Sync trigger:
  [ ] Manual (user clicks sync)
  [ ] Scheduled (cron job)
  [ ] Webhook (source pushes updates)
  [ ] Real-time (websocket)

Sync window: _______________ (e.g., "last 30 days")

Deduplication:
  - Check field: _______________ (usually externalId)

Update existing items?
  [ ] Yes - Update if source changes
  [ ] No - Only insert new items
```

### 9. UI Customization

Any special UI needs?

```
[ ] Custom card display
[ ] Custom sidebar sections
[ ] Custom detail modal content
[ ] Special icons or colors
```

---

## Implementation Checklist

After completing the interview, implement:

### Required Files

```
src/lib/{connector}/
  ├── client.ts          # API client
  ├── sync.ts            # Sync logic
  └── types.ts           # TypeScript types (optional)

src/app/api/{connector}/
  ├── sync/route.ts      # Sync endpoint
  └── status/route.ts    # Status endpoint (optional)
```

### Database

1. Add connector to `connectorTypeEnum` in `src/lib/db/schema/triage.ts`:
   ```typescript
   export const connectorTypeEnum = pgEnum("connector_type", [
     "gmail",
     "slack",
     "linear",
     "granola",
     "manual",
     "your_connector",  // Add here
   ]);
   ```

2. Run migration:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

### Triage Client Updates

1. Add to `CONNECTOR_ACTIONS` in `src/app/triage/triage-client.tsx`:
   ```typescript
   your_connector: {
     canReply: false,
     canArchive: true,
     canAddToMemory: true,
     canTakeActions: true,
     canChat: true,
   },
   ```

2. Add to `CONNECTOR_FILTERS` if you want a filter tab:
   ```typescript
   { value: "your_connector", label: "Your Connector", icon: YourIcon },
   ```

### Custom Enrichment

If using custom enrichment, update the enrichment type in schema:
```typescript
enrichment: jsonb("enrichment").$type<{
  // Standard fields...

  // Your connector's custom fields
  yourField?: string;
  yourOtherField?: number;
}>(),
```

### Memory Extraction

If auto-extracting memory, use the pattern from Granola:
```typescript
import { extractMemoryFromContent } from "@/lib/granola/extract-memory";

// During sync
const extractedMemory = await extractMemoryFromContent(content, subject);
await saveExtractedMemoryToDb(extractedMemory, itemId);
```

### Task Extraction

If extracting tasks, use the task extraction helper:
```typescript
import { extractAndSaveTasks } from "@/lib/triage/extract-tasks";

// During sync or after insert
await extractAndSaveTasks(itemId, content, subject);
```

---

## Existing Connectors

| Connector | Reply | Custom Enrichment | Auto Memory | Tasks |
|-----------|-------|-------------------|-------------|-------|
| gmail | Yes | No | No | Yes |
| slack | Yes | No | No | Yes |
| linear | No | No | No | Yes |
| granola | No | Yes (meeting data) | Yes | Yes |
| manual | No | No | No | Yes |

---

## Testing

1. Test sync with small batch
2. Verify enrichment populates correctly
3. Test all supported actions
4. Verify memory extraction (if applicable)
5. Verify task extraction (if applicable)
6. Test deduplication on re-sync

## Documentation

Create `docs/connectors/{connector}.md` with:
- Overview and capabilities table
- What gets synced
- Custom enrichment fields
- Sync process diagram
- API endpoints
- Configuration
- Triage workflow tips
