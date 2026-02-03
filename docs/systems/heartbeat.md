# Heartbeat System

> The heartbeat is the central process that keeps Aurelius's memory system alive. It processes raw inputs into searchable knowledge.

## Overview

Heartbeat is a periodic background process that:
1. **Extracts entities** from daily notes (people, companies, projects)
2. **Syncs external sources** (Granola meetings → triage inbox)
3. **Reindexes search** (QMD hybrid search index)

Without heartbeat running, new information stays trapped in raw form and isn't searchable by the AI.

## Why Heartbeat Exists

```
Raw Information                    Searchable Knowledge
─────────────────                  ────────────────────
Daily notes (.md)     ──────┐
                            │
Granola meetings      ──────┼──→  HEARTBEAT  ──→  Entity files (life/)
                            │                      QMD search index
Chat conversations    ──────┘                      Triage inbox
```

**The Problem:** Information enters the system continuously (chats, meetings, notes), but the AI can only recall what's been indexed.

**The Solution:** Heartbeat periodically processes raw inputs into structured, searchable knowledge.

## What Heartbeat Does

### Step 1: Entity Extraction from Daily Notes

Scans the last 3 days of daily notes (`memory/*.md`) and extracts:

| Entity Type | Example | Storage Location |
|-------------|---------|------------------|
| People | "John Smith" | `life/areas/people/john-smith/` |
| Companies | "Acme Corp" | `life/areas/companies/acme-corp/` |
| Projects | "Project Alpha" | `life/projects/project-alpha/` |

**Extraction methods:**
- **Ollama LLM** (preferred): Uses local `llama3.2:3b` model for intelligent extraction
- **Pattern matching** (fallback): Simple regex when Ollama unavailable

Each entity gets:
- `summary.md` - Description and metadata
- `items.json` - Facts with timestamps, sources, and access tracking

### Step 1b: Smart Entity Resolution

After extraction, heartbeat resolves extracted names to existing entities using multi-signal scoring:

```
"Adam" + architecture context → "Adam Watson" (90% confidence)
"Sarah" + code review context → "Sarah Chen" (85% confidence)
"ROSTR" (any case) → "rostr" (100% confidence)
```

Key features:
- **Multi-signal scoring**: Name similarity (50%) + context overlap (35%) + recency (15%)
- **Partial name matching**: "Adam" → "Adam Watson" when context aligns
- **Cross-type protection**: Won't create "Adam Watson" as company if person exists
- **Batch deduplication**: Multiple mentions in one note → one entity
- **Fact deduplication**: Redundant facts (same info rephrased) skipped
- **Filtering**: Locations, short terms, generic project names excluded

**See:** [Entity Resolution](./entity-resolution.md) for full details on scoring, thresholds, and examples.

### Step 2: Granola Meeting Sync

If Granola is configured:
1. Fetches meetings since last sync (or last 7 days)
2. Downloads full transcripts
3. Extracts entities, facts, action items via AI
4. Saves to PostgreSQL (`entities`, `facts` tables with embeddings)
5. Creates triage inbox items for review

### Step 3: QMD Reindex

Updates the hybrid search index:
```bash
qmd update  # Update document index (60s timeout)
qmd embed   # Create vector embeddings (120s timeout)
```

This makes all new content searchable via:
- BM25 keyword search
- Vector semantic search
- Combined hybrid search with reranking

## Scheduling

### Automatic (Recommended)

Heartbeat runs automatically when the app starts via `node-cron`:

| Schedule | Interval | Why |
|----------|----------|-----|
| Default | Every 15 minutes | Balance between freshness and resource usage |
| Configurable | Via `HEARTBEAT_INTERVAL_MINUTES` env var | Adjust based on your needs |

The scheduler starts when you run `bun run dev` and logs:
```
[Scheduler] Heartbeat scheduled: every 15 minutes
[Scheduler] Next heartbeat at: 2024-02-02T10:15:00
```

### Manual Trigger

**Via UI:**
- Go to System page → Click "Heartbeat" button

**Via API:**
```bash
# Simple GET (runs full heartbeat)
curl http://localhost:3333/api/heartbeat

# Quick mode (skip QMD reindex - faster but new content not searchable)
curl http://localhost:3333/api/heartbeat?quick=true

# Full control via POST
curl -X POST http://localhost:3333/api/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "trigger": "manual",
    "skipReindex": false,
    "skipGranola": false,
    "skipExtraction": false
  }'
```

**Options:**
| Option | Effect |
|--------|--------|
| `quick=true` | Skip QMD reindex (fast partial heartbeat) |
| `skipReindex` | Skip QMD update and embed |
| `skipGranola` | Skip Granola meeting sync |
| `skipExtraction` | Skip entity extraction from daily notes |

### Check Status

```bash
curl http://localhost:3333/api/heartbeat/status
```

Returns:
```json
{
  "health": "healthy",
  "schedulerRunning": true,
  "lastHeartbeat": {
    "timestamp": "2024-02-02T10:00:00Z",
    "age": "5m 30s ago",
    "success": true,
    "trigger": "scheduled",
    "duration": 45000
  },
  "recentStats": {
    "total": 10,
    "successes": 9,
    "failures": 1,
    "successRate": 90
  }
}
```

## Configuration

### Environment Variables

```bash
# Heartbeat scheduling (optional, defaults shown)
HEARTBEAT_INTERVAL_MINUTES=15    # How often to run
HEARTBEAT_ENABLED=true           # Set to false to disable auto-scheduling

# Ollama (for entity extraction)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# Granola (optional)
# Configured via /api/connectors/granola/setup
```

### Timeouts

| Operation | Timeout | Configurable |
|-----------|---------|--------------|
| Ollama check | 2s | No |
| Entity extraction | 30s per note | No |
| Granola sync | 60s | No |
| QMD update | 60s | No |
| QMD embed | 120s | No |
| **Total heartbeat** | 120s | Via API route |

## Monitoring

### Activity Log

All heartbeat runs are logged to `activity-log.json`:

```json
{
  "type": "heartbeat",
  "timestamp": "2024-02-02T10:00:00Z",
  "trigger": "scheduled",
  "success": true,
  "metadata": {
    "entitiesCreated": 2,
    "entitiesUpdated": 5,
    "reindexed": true,
    "extractionMethod": "ollama",
    "granola": { "synced": 1, "skipped": 0 }
  }
}
```

### Console Logs

```
[Heartbeat] Starting...
[Heartbeat] Extraction method: Ollama LLM
[Heartbeat] Ollama extracted 3 entities from 2024-02-02
[Heartbeat] Created entity: Jane Doe (person)
[Heartbeat] Updated entity: Acme Corp
[Heartbeat] Granola: synced 1 meetings
[Heartbeat] QMD reindexed
[Heartbeat] Complete - created: 1, updated: 2
```

### Health Check

Check heartbeat status:
```bash
# View recent activity
curl http://localhost:3000/api/activity-log?type=heartbeat&limit=5

# Check if scheduler is running (look for startup logs)
```

## Troubleshooting

### Check Heartbeat Health First

Always start by checking status:
```bash
curl http://localhost:3333/api/heartbeat/status
```

This shows:
- Whether the scheduler is running
- When the last heartbeat ran
- Recent success/failure rate
- Any error messages

### Memories Not Appearing in Chat

**Symptom:** You added information but the AI can't recall it.

**Causes & Solutions:**

1. **Heartbeat hasn't run yet**
   - Check: `curl http://localhost:3333/api/heartbeat/status`
   - Fix: Run heartbeat manually or wait for scheduled run

2. **QMD reindex failed/timed out**
   - Check: Look at `steps.qmdEmbed` in heartbeat response
   - Fix: Run `qmd update && qmd embed` manually, check for errors
   - Note: Heartbeat now shows partial success - if `qmdUpdate` succeeded but `qmdEmbed` failed, keyword search works but semantic search is stale

3. **Content not in searchable format**
   - Check: Is the content in daily notes? (`memory/*.md`)
   - Fix: Ensure chat extraction is working, or add notes manually

### Heartbeat Taking Too Long

**Symptom:** Heartbeat times out or takes several minutes.

**Causes & Solutions:**

1. **Large QMD index**
   - Check: `ls -la ~/.cache/qmd/`
   - Fix: Use `quick=true` mode for faster partial heartbeats, or run full heartbeat less frequently

2. **Ollama slow/unavailable**
   - Check: `curl http://localhost:11434/api/tags`
   - Fix: Start Ollama, or it will fall back to pattern matching
   - Note: Check `steps.extraction` in response for timing

3. **Many Granola meetings to sync**
   - Check: Look at `steps.granola.durationMs` in response
   - Fix: Run heartbeat more frequently to process incrementally

### Partial Failures

Heartbeat now handles partial failures gracefully. Check the response:

```json
{
  "allStepsSucceeded": false,
  "warnings": ["QMD embed failed: timeout"],
  "steps": {
    "extraction": { "success": true, "durationMs": 5000 },
    "granola": { "success": true, "durationMs": 2000 },
    "qmdUpdate": { "success": true, "durationMs": 3000 },
    "qmdEmbed": { "success": false, "durationMs": 180000, "error": "timeout" }
  }
}
```

Each step runs independently - a failure in one doesn't stop the others.

### Ollama Not Working

**Symptom:** Logs show "Pattern matching" instead of "Ollama LLM"

**Causes & Solutions:**

1. **Ollama not running**
   ```bash
   # Start Ollama
   ollama serve

   # Check it's running
   curl http://localhost:11434/api/tags
   ```

2. **Model not downloaded**
   ```bash
   ollama pull llama3.2:3b
   ```

3. **Wrong URL configured**
   - Check `OLLAMA_URL` environment variable

### Scheduler Not Running

**Symptom:** Heartbeats only happen when you trigger them manually.

**Check the server logs** for:
```
[Scheduler] Heartbeat scheduled: every 15 minutes
[Scheduler] Next heartbeat at: 2026-02-02T10:15:00.000Z
```

> **Note:** The `/api/heartbeat/status` endpoint may show `schedulerRunning: false` even when the scheduler is working. This is because Next.js runs instrumentation in a separate context. Trust the server logs.

**Causes if scheduler not starting:**
1. Server was started before `instrumentation.ts` was added → restart the dev server
2. `HEARTBEAT_ENABLED=false` in environment → remove or set to true
3. Dev server not running → start with `bun run dev`

## Architecture

### File Locations

```
src/
├── lib/memory/
│   ├── heartbeat.ts         # Main heartbeat logic
│   ├── entity-resolution.ts # Smart entity matching (name + context + recency)
│   ├── ollama.ts            # LLM entity extraction
│   ├── daily-notes.ts       # Daily note operations
│   └── activity-log.ts      # Logging
├── app/api/
│   └── heartbeat/
│       └── route.ts         # API endpoint
└── instrumentation.ts       # Scheduler setup

scripts/
└── test-heartbeat-scenarios.ts  # Comprehensive entity resolution tests

life/                     # Entity storage (created by heartbeat)
├── areas/
│   ├── people/
│   └── companies/
└── projects/

memory/                   # Daily notes (input to heartbeat)
└── YYYY-MM-DD.md
```

### Data Flow

```
                    ┌─────────────────────────────────────────┐
                    │              HEARTBEAT                   │
                    │                                          │
 Daily Notes ──────>│  1. Read recent notes (3 days)          │
 (memory/*.md)      │  2. Extract entities (Ollama/patterns)  │
                    │  3. Create/update entity files          │──> life/
                    │                                          │
 Granola API ──────>│  4. Fetch new meetings                  │
                    │  5. Extract & save to DB                │──> PostgreSQL
                    │  6. Create triage items                 │
                    │                                          │
                    │  7. qmd update (document index)         │──> QMD Index
                    │  8. qmd embed (vector embeddings)       │
                    └─────────────────────────────────────────┘
                                       │
                                       v
                              Chat can now search
                              all processed content
```

## Synthesis (Memory Decay)

### Overview

Synthesis is a companion process to heartbeat that manages memory decay:

1. **Calculates tiers** for all facts (hot/warm/cold) based on access patterns
2. **Archives cold facts** - Facts not accessed in 30+ days get archived
3. **Regenerates summaries** - Updates entity summaries with only active facts
4. **Reindexes search** - Updates QMD index after archiving

### Why Synthesis Exists

Without decay, entities accumulate stale facts indefinitely. Synthesis ensures:
- Entity summaries stay relevant and concise
- Search results prioritize current information
- Storage doesn't grow unbounded with obsolete facts

### Decay Tiers

| Tier | Access Pattern | Treatment |
|------|----------------|-----------|
| **Hot** | Accessed in last 7 days, OR high access count (10+) | Included in summaries |
| **Warm** | Accessed 8-30 days ago | Included in summaries |
| **Cold** | 30+ days without access AND low access count | Archived (excluded from summaries) |

High-access facts (10+ accesses) resist decay, staying hot/warm longer.

### Scheduling

Synthesis runs automatically daily at 3 AM (configurable):

```bash
# Configure synthesis (optional, defaults shown)
SYNTHESIS_HOUR=3           # Hour to run (0-23, default 3 AM)
SYNTHESIS_ENABLED=true     # Set to false to disable
```

### Manual Trigger

```bash
# Via API
curl -X POST http://localhost:3333/api/synthesis

# Or via GET
curl http://localhost:3333/api/synthesis
```

### Check Status

Synthesis status is included in the heartbeat status endpoint:

```bash
curl http://localhost:3333/api/heartbeat/status
```

Look for the `synthesis` section in the response:

```json
{
  "synthesis": {
    "schedulerRunning": true,
    "lastRun": {
      "timestamp": "2024-02-02T03:00:00Z",
      "age": "10h ago",
      "success": true,
      "entitiesProcessed": 87,
      "factsArchived": 12,
      "summariesRegenerated": 15
    }
  }
}
```

## Best Practices

1. **Keep heartbeat running** - Use the automatic scheduler
2. **Monitor the logs** - Watch for failures, especially QMD timeouts
3. **Run Ollama** - Much better entity extraction than pattern matching
4. **Check after adding important info** - Run manual heartbeat if something urgent needs to be searchable immediately
5. **Don't run too frequently** - Every 15 minutes is usually enough; more frequent = more resource usage
6. **Let synthesis run overnight** - Default 3 AM schedule keeps memory fresh without impacting daytime performance

## Related Documentation

- [Architecture Overview](../../ARCHITECTURE.md) - How heartbeat fits in the system
- [Memory System](./memory.md) - How all memory layers work together
- [Daily Notes](./daily-notes.md) - Short-term memory that heartbeat processes
