# Reading List Feature Design

> Date: 2026-02-11
> Status: Approved

## Overview

A reading list page in Aurelius that collects and summarizes content from external sources, starting with X/Twitter bookmarks. Items are scraped via browser automation (Claude in Chrome), AI-summarized, and displayed as a simple reference list.

## Data Model

New `reading_list` table:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Primary key |
| source | text | Source type: 'x-bookmark', 'manual', future sources |
| sourceId | text | Unique ID from source (tweet ID, URL, etc.) |
| url | text | Link to original content |
| title | text | Author name / thread opener |
| content | text | Full tweet/thread text |
| summary | text | AI-generated 1-2 sentence summary |
| tags | text[] | AI-generated topic tags |
| rawPayload | jsonb | Original scraped data |
| status | text | 'unread' / 'read' / 'archived' (default: 'unread') |
| createdAt | timestamp | When item was added |

`sourceId` is used for deduplication on re-sync.

## Scraping: X Bookmarks

Uses Claude in Chrome browser automation tools with the user's authenticated X session:

1. Navigate to `x.com/i/bookmarks`
2. Snapshot the page to extract tweet content
3. Scroll and repeat until hitting already-stored bookmarks (match by tweet ID)
4. Extract per bookmark: tweet ID, author, text, URL, media links, timestamp

**Manual trigger only** — browser scraping requires Chrome open with active session, so scheduling doesn't help. User clicks "Sync X" button on the reading list page.

## Summarization Pipeline

Each new bookmark (not already in DB by sourceId):

1. Send content to OpenRouter (kimi-k2, cheaper model for bulk)
2. Prompt: summarize in 1-2 sentences + assign 1-3 topic tags
3. Tag vocabulary: tech, business, design, AI, finance, culture, health, science, other
4. Insert into `reading_list` with summary + tags

Sequential processing — bookmark volumes are small (tens, not hundreds).

## UI: `/reading-list` page

Card-based list layout:

- **Sync X button** — triggers scrape + summarize pipeline
- **Tag filter bar** — filter by tags present in data
- **Cards** — source badge, author, relative time, summary, tags
- **Actions** — "Open" (link to original), "Archive" (hide from default view)
- **Default view** — unread + read items, newest first
- **Read marking** — clicking a card marks it read (subtle visual dimming)
- **Nav entry** — in sidebar alongside Chat, Triage, etc.

## API Routes

- `GET /api/reading-list` — list items, optional status/tag query params
- `PATCH /api/reading-list/[id]` — update status (read/archived)
- `POST /api/reading-list/sync` — trigger browser scrape → summarize → store

## Files

| File | Purpose |
|------|---------|
| `lib/db/schema/reading-list.ts` | Drizzle table definition |
| `lib/reading-list/x-bookmarks.ts` | Browser scraping logic |
| `lib/reading-list/summarize.ts` | OpenRouter summarization |
| `app/api/reading-list/route.ts` | GET + POST (list + sync) |
| `app/api/reading-list/[id]/route.ts` | PATCH (status update) |
| `app/reading-list/page.tsx` | Page component |
| `components/aurelius/reading-list-card.tsx` | Card component |

## Out of Scope (future)

- Other sources beyond X bookmarks
- Heartbeat/scheduled sync
- Full-text search
- Chat integration ("what's on my reading list?")
