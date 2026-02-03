# Entity Resolution

> Smart matching of extracted names to existing entities using multi-signal scoring.

## Overview

When heartbeat extracts entities from daily notes, it doesn't just create new records blindly. It uses smart resolution to match extracted names against existing entities.

```
Input: "Adam sent the architecture docs"
       ↓
Extraction: { name: "Adam", type: "person" }
       ↓
Resolution: Existing "Adam Watson" (CTO, architecture) → 90% match
       ↓
Result: Update Adam Watson's facts, don't create standalone "Adam"
```

## Why Entity Resolution Exists

**The Problem:**
- Notes often use partial names ("Adam" instead of "Adam Watson")
- Same entity appears with variations ("STUBHUB", "StubHub", "Stubhub")
- Context matters ("Sarah" in code review → Sarah Chen, engineer)
- Without resolution: duplicates, fragmented knowledge, search pollution

**The Solution:**
Multi-signal scoring considers name similarity, context overlap, and recency to find the best match.

## Scoring Signals

Resolution uses three weighted signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| **Name similarity** | 50% | How closely names match |
| **Context overlap** | 35% | Shared keywords between note and entity facts |
| **Recency/decay** | 15% | Recently accessed entities rank higher |

### Name Similarity (50%)

Multiple matching strategies:

| Match Type | Score | Example |
|------------|-------|---------|
| Exact | 100% | "Adam Watson" = "Adam Watson" |
| Case-insensitive exact | 100% | "STUBHUB" = "StubHub" |
| Prefix match | 80% | "Adam" matches "Adam Watson" |
| Abbreviation | 70% | "Adam W." matches "Adam Watson" |
| Partial overlap | 60% | "Watson" matches "Adam Watson" |

### Context Overlap (35%)

Extracts keywords from note content and compares with entity facts:

```
Note: "Adam sent the architecture docs for the API redesign"
Keywords: [architecture, docs, api, redesign]

Adam Watson facts:
- "CTO based in San Diego"
- "Leads architecture team"
- "Working on API redesign"
Keywords: [cto, san diego, architecture, api, redesign]

Overlap: [architecture, api, redesign] → 3/4 = 75% context match
```

### Recency/Decay (15%)

Recently accessed entities get a boost:

| Last Accessed | Recency Score |
|---------------|---------------|
| Today | 100% |
| This week | 80% |
| This month | 50% |
| Older | 20% |

High-access entities (10+ accesses) also get boosted regardless of date.

## Resolution Process

```
1. Extract entities from note (Ollama LLM)
   ↓
2. For each extracted entity:
   a. Load candidates (existing entities of same type)
   b. Score each candidate (name + context + recency)
   c. Check cross-type conflicts
   d. Decide: match existing OR create new
   ↓
3. Apply actions (update facts / create entity)
```

### Confidence Thresholds

| Confidence | Action |
|------------|--------|
| ≥80% | Resolve to existing entity |
| 50-79% | Ask LLM to decide (with context) |
| <50% | Create new entity |

### LLM Tie-Breaking

When confidence is 50-79%, we ask Ollama:

```
Given the extracted name "Sarah" with context about code review,
and existing entity "Sarah Chen" (lead engineer, Austin),
should they be merged?

Consider:
- Name similarity: 80%
- Context overlap: 60%
- Overall confidence: 68%
```

## Protection Features

### Cross-Type Protection

Prevents creating wrong entity types:

```
Existing: "Adam Watson" (person)
Extracted: "Adam Watson" mentioned as company
→ Blocked: Won't create company with same name as existing person
```

### Batch Deduplication

Within a single heartbeat run, tracks what's being created:

```
Note mentions: "Marcus Webb", "Marcus", "Webb"
→ Creates: 1 entity (Marcus Webb)
→ Not: 3 entities
```

### Fact Deduplication

Prevents storing redundant facts:

```
Existing: "CTO based in San Diego"
Extracted: "Adam is the CTO and lives in San Diego"
→ Skipped: Semantically equivalent fact
```

## Filtering

### Location Blacklist

Common locations filtered from extraction:

```
San Francisco, San Diego, New York, Los Angeles, Austin,
Toronto, London, Paris, Tokyo, Berlin, Sydney, Lagos,
Rio, Ojai, Córdoba, Buenos Aires
```

### Short Term Blacklist

Generic short terms filtered:

```
AI, ML, PM, CTO, CEO, API, UI, UX
```

### Generic Project Blacklist

Vague project names filtered:

```
API redesign, backend systems, beta milestone,
dashboard integration, core API
```

## Examples

### Partial Name Resolution

```
Note: "Adam reviewed the PR and approved it"

Candidates:
- Adam Watson (CTO, architecture) → 85% match
- Adam Johnson (legal team) → 45% match

Result: Resolves to Adam Watson (architecture context aligns)
```

### Company Variation

```
Note: "Meeting with STUBHUB tomorrow about the partnership"

Candidates:
- StubHub (existing company) → 100% match (case-insensitive)

Result: Updates StubHub, doesn't create "STUBHUB"
```

### Context Disambiguation

```
Note: "Sarah merged the authentication PR"

Candidates:
- Sarah Chen (engineer, code review) → 88% match
- Sarah Miller (marketing) → 35% match

Result: Resolves to Sarah Chen (code context matches)
```

### New Entity Creation

```
Note: "Jennifer Park from Netflix called about licensing"

Candidates:
- Jennifer Lee (finance team) → 40% match (different context)

Result: Creates new "Jennifer Park" entity (low match, different person)
```

## Configuration

### Environment Variables

```bash
# Ollama for extraction and LLM tie-breaking
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
```

### Thresholds (in code)

```typescript
// src/lib/memory/entity-resolution.ts
const HIGH_CONFIDENCE_THRESHOLD = 0.80;  // Auto-resolve
const LOW_CONFIDENCE_THRESHOLD = 0.50;   // Ask LLM
```

## File Locations

| File | Purpose |
|------|---------|
| `src/lib/memory/entity-resolution.ts` | Core resolution logic |
| `src/lib/memory/ollama.ts` | LLM extraction + filtering |
| `src/lib/memory/heartbeat.ts` | Orchestrates resolution |
| `scripts/test-heartbeat-scenarios.ts` | Test suite (24 tests) |

## Testing

Run the comprehensive test suite:

```bash
npx tsx scripts/test-heartbeat-scenarios.ts
```

Test categories:
- Similar names (Adam vs Adam Watson)
- Company variations (STUBHUB vs StubHub)
- Contextual resolution (Sarah + code → Sarah Chen)
- Ambiguous entities (Mercury project vs company)
- Duplicate prevention
- Long-term memory references
- Edge cases (accents, all-caps, short terms)
- Cross-type resolution

Current pass rate: **87.5%** (21/24 tests)

## Known Limitations

1. **LLM extraction inconsistency**: Ollama sometimes misses full names ("Adam Johnson" not extracted)
2. **Cross-run state**: Historical note reprocessing can create duplicates
3. **Cross-type pollution**: Manual entity creation can create conflicts

## Related Documentation

- [Heartbeat](./heartbeat.md) - Background processing that triggers resolution
- [Memory System](./memory.md) - Overall memory architecture
- [Daily Notes](./daily-notes.md) - Source content for extraction
