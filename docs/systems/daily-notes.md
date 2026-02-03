# Daily Notes

Daily notes are the short-term memory layer of Aurelius. They capture conversations and events as they happen, providing immediate context to the AI.

## Overview

```
Chat/Events → Daily Notes → Heartbeat → Structured Memory (life/)
                  ↓
            Direct Context (last 24h)
```

Daily notes serve two purposes:
1. **Immediate recall** - Last 24 hours directly available in chat context
2. **Processing queue** - Heartbeat extracts entities and facts into structured memory

## File Format

**Location:** `memory/YYYY-MM-DD.md`

**Structure:**
```markdown
# Monday, February 2, 2026

## 10:15

User mentioned meeting with John Smith about Project Alpha.
They discussed timeline concerns and budget allocation.

## 14:30

User asked about StubHub contacts. Retrieved information about
Sarah from previous meetings.
```

Each entry has:
- Timestamp header (`## HH:MM` in 24-hour format)
- Content from the conversation

## How Notes Are Created

### Automatic Extraction

When you chat with Aurelius, notable content is automatically saved:

```typescript
// In chat/route.ts
if (containsMemorableContent(message)) {
  await extractAndSaveMemories(message, fullResponse);
}
```

**What triggers extraction:**
- Names mentioned (people, companies)
- Projects or topics discussed
- Preferences expressed
- Important context shared

### Manual Addition

You can also add notes via:
- `/api/daily-notes` endpoint
- Triage "Add to Memory" action
- Direct file editing

## How Notes Are Used

### Direct Context (Last 24 Hours)

Recent notes are included directly in every chat:

```
## Recent Activity (Last 24 Hours)

[Today's daily note content]
[Yesterday's note if before noon]
```

This happens **without QMD search** - the AI always has access to recent activity.

**Rolling window:**
- Always includes today's note
- Includes yesterday if current time is before noon
- Prevents stale context while maintaining continuity

### Indexed Search (Older Notes)

Older daily notes are searchable via QMD after heartbeat reindexes:

```
Heartbeat runs → qmd update → qmd embed → Notes searchable
```

This typically takes 15 minutes (heartbeat interval).

## Configuration

### Timezone

Daily notes use **your timezone** for all date operations:

```bash
# In .env.local (defaults to America/Los_Angeles)
USER_TIMEZONE=America/Los_Angeles
```

This ensures:
- Filenames match your local date (`2026-02-02.md` when it's Feb 2 for you)
- Timestamps in entries match your local time
- "Yesterday" calculations work correctly

**Common timezone values:**
- `America/Los_Angeles` - Pacific Time
- `America/New_York` - Eastern Time
- `America/Chicago` - Central Time
- `Europe/London` - UK
- `Europe/Paris` - Central European

### Token Budget

Recent notes are capped at ~2000 tokens (~8000 characters):

```typescript
const recentNotes = await getRecentNotes({ maxTokens: 2000 });
```

If notes exceed this limit, oldest entries are truncated.

### Heartbeat Processing

Heartbeat scans the last 3 days of notes to extract entities:

```
Daily Note Entry → Ollama LLM → Entity (person/company/project)
                       ↓
                  Entity File (life/areas/people/john-smith/)
```

## Troubleshooting

### Recent Conversation Not Recalled

**Symptom:** AI doesn't remember something you just discussed.

**Check:**
1. Was the content "memorable"? Simple greetings aren't saved.
2. Is the note in `memory/YYYY-MM-DD.md`? Check the file directly.
3. Token limit hit? Very long notes may truncate older content.

### Notes Not Appearing in Search

**Symptom:** Can't find older notes via search.

**Check:**
1. Is the note older than 24 hours? Recent notes use direct access, not search.
2. Has heartbeat run? Check `/api/heartbeat/status`.
3. Did QMD reindex succeed? Check heartbeat logs for errors.

## Related Documentation

- [Memory System Overview](./memory.md) - How all memory layers work together
- [Heartbeat](./heartbeat.md) - Background processing that indexes notes
- [Architecture](../../ARCHITECTURE.md) - System overview
