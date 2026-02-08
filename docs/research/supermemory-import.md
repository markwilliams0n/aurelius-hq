# Supermemory Import: Backdated Timestamps Research

Research completed 2026-02-07.

## TL;DR

**Supermemory's "decay" is primarily semantic, not temporal.** The static/dynamic split in the profile endpoint is based on content type (stable facts vs recent context), not on `createdAt` age. There is no SDK or API support for setting custom timestamps. Importing all 252 items with today's date is likely fine — the extraction pipeline should correctly categorize biographical facts as "static" and recent events as "dynamic" regardless of ingestion date.

---

## Finding 1: No createdAt/Timestamp Parameter for Writes

The SDK (v4.0.0) `AddParams` accepts exactly four fields:

```typescript
export interface AddParams {
  content: string;
  containerTag?: string;
  containerTags?: Array<string>; // deprecated
  customId?: string;
  metadata?: { [key: string]: string | number | boolean | Array<string> };
}
```

Same for `MemoryAddParams` (`POST /v3/documents`), `DocumentBatchAddParams` (`POST /v3/documents/batch`), and `MemoryUpdateParams` (`PATCH /v3/documents/:id`).

Response types include `createdAt` and `updatedAt` as **read-only server-assigned fields**.

## Finding 2: Metadata Does Not Influence Decay

Metadata supports filtering only (`metadata`, `numeric`, `array_contains`, `string_contains`). No `date`/`timestamp`/`temporal` filter type. A `timestamp` key in metadata is queryable but does NOT affect profile categorization, search scoring, or decay.

## Finding 3: How "Decay" Actually Works

The profile endpoint (`POST /v4/profile`) returns:

```typescript
interface Profile {
  dynamic: Array<string>;  // "recent memories"
  static: Array<string>;   // "long-term relevant"
}
```

Driven by **semantic extraction**, not time-based decay. When content is added, Supermemory's LLM extracts memories and classifies them with relationship types: `updates` (supersedes), `extends` (enriches), `derives` (infers). Static/dynamic split is content-based.

Search endpoints return `score`/`similarity` based on embedding similarity with optional `rerank`. No documented time-decay factor.

## Finding 4: No Bulk Import/Migration Endpoint with Timestamps

- `client.documents.batchAdd()` — same fields, no timestamp
- `client.connections.import()` — for Notion/Google Drive/GitHub/OneDrive/web-crawler only

## Finding 5: Undocumented Parameters (Worth a Quick Test)

The SDK supports sending undocumented params:

```typescript
client.add({
  content: 'content',
  // @ts-expect-error createdAt is not in the SDK types
  createdAt: '2025-06-15T00:00:00Z',
});
```

Might silently ignore or might accept — 5-minute test to find out.

## Finding 6: Expiration Concept Exists But Not Settable

Search endpoint has `forgottenMemories?: boolean` — "include memories that have been explicitly forgotten or have passed their expiration date." Suggests internal expiration concept, but no way to set one.

---

## Options

| Option | Effort | Effectiveness | Risk |
|--------|--------|---------------|------|
| **A: Import as-is** | Trivial | Good (semantic decay handles it) | None |
| **B: Test undocumented `createdAt`** | 5 min | Perfect if it works | Likely ignored |
| **C: Contact Supermemory** | Days | Authoritative answer | Waiting |
| **D: Stagger imports over weeks** | High | Poor (30 days spread max) | Not worth it |
| **E: Prepend dates to content** | Low | Moderate (LLM sees temporal context) | Minor noise |

## Recommended Approach

1. **Quick test Option B** (5 min): Send one test memory with `createdAt`. Retrieve and check if the date stuck.
2. **If that fails, use Option A + E**: Import all 252 with date prepended to content + original timestamp in metadata + `customId` for dedup safety.
3. **Async: Contact Supermemory** (dhravya@supermemory.com) about migration API.

## Cost Estimate

| Resource | Estimate |
|----------|----------|
| API calls | 252 individual or ~26 batch calls (10 per batch) |
| Tokens processed | ~125K-500K (Supermemory's extraction LLM) |
| Tier impact | Fits in Free tier (1M tokens/month) |
| Time to import | ~1-2 minutes |

## Source Files Examined

- `node_modules/supermemory/src/resources/top-level.ts` — AddParams, ProfileResponse
- `node_modules/supermemory/src/resources/memories.ts` — MemoryAddParams, MemoryGetResponse, MemoryUpdateParams
- `node_modules/supermemory/src/resources/documents.ts` — DocumentBatchAddParams
- `node_modules/supermemory/src/resources/search.ts` — forgottenMemories, search scoring
- `node_modules/supermemory/README.md` — undocumented params pattern
