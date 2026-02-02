# Granola Integration Design

**Date:** 2026-02-02
**Status:** Approved

## Overview

Integrate Granola meeting notes into Aurelius triage system. Meetings sync via heartbeat, appear in triage inbox, full transcripts stored for memory extraction.

## Scope

- Granola as a triage connector (like Gmail, Slack, Linear)
- Token management with OAuth refresh rotation
- Heartbeat-triggered sync
- Full meeting storage in triage `rawPayload`

**Out of scope:** Task extraction (future work), real-time sync (polling only).

## Architecture

### File Structure

```
src/lib/granola/
├── client.ts      # API wrapper + token rotation
├── sync.ts        # Sync logic for heartbeat
└── index.ts       # Exports

src/app/api/connectors/granola/
└── setup/route.ts # Initial token setup endpoint
```

### Token Storage

Uses existing `configs` table with key `connector:granola`:

```typescript
{
  key: 'connector:granola',
  content: JSON.stringify({
    refresh_token: string,
    access_token: string,
    access_token_expires_at: number,
    client_id: string,
    last_synced_at: string
  })
}
```

### Token Rotation

Granola uses WorkOS OAuth with single-use refresh tokens:

1. Check if access token valid (< 1hr old)
2. If expired, call WorkOS `/user_management/authenticate`
3. **Save new refresh token immediately** (old one is invalidated)
4. Return access token

### Triage Item Mapping

```typescript
{
  connector: 'granola',
  externalId: meeting.id,
  sender: meeting.organizer || 'Meeting',
  senderName: meeting.title,
  subject: meeting.title,
  preview: first 200 chars of notes,
  content: full markdown notes,
  rawPayload: {
    transcript: [...],
    attendees: [...],
    calendarEvent: {...}
  },
  receivedAt: meeting.created_at,
  status: 'new'
}
```

### Sync Flow

1. Heartbeat calls `syncGranolaMeetings()`
2. Get access token (refresh if needed)
3. Fetch meetings since `last_synced_at`
4. For each meeting not already in triage (by externalId):
   - Fetch full document with transcript
   - Transform to triage item
   - Insert into inbox
5. Update `last_synced_at`

### API Endpoints

**POST /api/connectors/granola/setup**

Initialize Granola connection with tokens extracted from Granola app.

Request:
```json
{
  "refresh_token": "string",
  "client_id": "string"
}
```

Response:
```json
{
  "success": true,
  "message": "Granola connected"
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/db/schema/triage.ts` | Add 'granola' to connector enum |
| `src/lib/memory/heartbeat.ts` | Call `syncGranolaMeetings()` |
| `ARCHITECTURE.md` | Document Granola connector |

## Implementation Order

1. Add 'granola' to triage connector enum
2. Create `src/lib/granola/client.ts` (API + token rotation)
3. Create `src/lib/granola/sync.ts` (triage sync)
4. Create setup endpoint
5. Add to heartbeat
6. Update ARCHITECTURE.md
