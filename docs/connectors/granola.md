# Granola Connector

Granola is an AI meeting notes app that captures and transcribes meetings. This connector syncs meeting notes into the triage system for review and memory extraction.

## Overview

| Property | Value |
|----------|-------|
| Connector ID | `granola` |
| Supports Reply | No |
| Supports Archive | Yes |
| Custom Enrichment | Yes (meeting-specific) |
| Auto Memory Extraction | Yes |
| Task Extraction | Yes |

## What Gets Synced

Each Granola meeting becomes an inbox item with:
- **Subject** - Meeting title
- **Content** - Full transcript
- **Sender** - "Granola" (meetings don't have a traditional sender)
- **Received At** - Meeting timestamp

## Custom Enrichment

Granola items include additional enrichment fields:

```typescript
enrichment: {
  // Standard fields
  summary: string;
  suggestedPriority: string;
  linkedEntities: Array<{ id, name, type }>;

  // Granola-specific
  attendees: string;           // Comma-separated attendee names
  meetingTime: string;         // Formatted meeting time
  topics: string[];            // Discussion topics
  actionItems: Array<{         // From Granola's extraction
    description: string;
    assignee?: string;
    dueDate?: string;
  }>;

  // Extracted memory (auto-saved during sync)
  extractedMemory: {
    entities: Array<{
      name: string;
      type: 'person' | 'company' | 'project';
      role?: string;
      facts: string[];
    }>;
    facts: Array<{
      content: string;
      category: string;
      entityName?: string;
      confidence: string;
    }>;
    actionItems: Array<{
      description: string;
      assignee?: string;
      dueDate?: string;
    }>;
    summary: string;
    topics: string[];
  };
}
```

## Memory Extraction

During sync, Granola items automatically go through AI memory extraction:

1. **Entity Detection** - Identifies people, companies, and projects mentioned
2. **Fact Extraction** - Pulls out key facts and relates them to entities
3. **Action Items** - Extracts commitments and tasks
4. **Summary** - Generates meeting summary
5. **Topics** - Identifies discussion topics

This extracted memory is stored in the enrichment for review but is **automatically saved to memory** during sync (not requiring manual "Memory" action).

## Task Extraction

Action items from meetings are converted to suggested tasks:
- Granola's own `actionItems` are used if available
- Additional AI extraction supplements if needed
- Tasks are categorized as "For You" or "For Others" based on assignee

## Sync Process

```
┌─────────────────┐
│  Granola API    │
└────────┬────────┘
         │ GET /documents
         ▼
┌─────────────────┐
│  Fetch Notes    │  Get meetings since last sync
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Check Existing  │  Skip already-synced meetings
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Enrichment   │  Extract memory, entities, tasks
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Save to Memory  │  Auto-save extracted facts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Tasks    │  Extract suggested tasks
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Insert Item    │  Add to inbox_items
└─────────────────┘
```

## API Endpoints

### GET /api/granola/sync
Trigger manual sync of Granola meetings.

Query params:
- `since` - ISO date to sync from (default: 30 days ago)

Returns:
```json
{
  "synced": 5,
  "skipped": 3,
  "errors": []
}
```

### GET /api/granola/status
Check Granola connection status.

## Configuration

Granola requires an API token. Set in environment:

```bash
GRANOLA_API_TOKEN=your_token_here
```

The token can be obtained from Granola's settings.

## Triage Workflow

When triaging Granola items:

1. **Review Summary** - Check the AI-generated summary in sidebar
2. **Check Extracted Memory** - Review entities and facts (already auto-saved)
3. **Review Tasks** - Accept or dismiss suggested action items
4. **Archive** - Mark as processed

The "Memory" action (↑) will re-extract and save facts, but this is usually unnecessary since memory is auto-saved during sync.

## Files

| File | Purpose |
|------|---------|
| `src/lib/granola/client.ts` | Granola API client |
| `src/lib/granola/sync.ts` | Sync logic |
| `src/lib/granola/extract-memory.ts` | AI memory extraction |
| `src/app/api/granola/sync/route.ts` | Sync API endpoint |
