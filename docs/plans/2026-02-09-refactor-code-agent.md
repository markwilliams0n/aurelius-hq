# Refactor: Code Agent System

**Branch:** `feature/refactor-code-agent`
**Date:** 2026-02-09

## Problem

The code agent (Aurelius's autonomous coding capability) has a 764-line handler god object that mixes session lifecycle, Telegram formatting, DB updates, global state management, and zombie detection. State derivation logic is duplicated across 3 UI components. The system is buggy and inconsistent — a clean structure will make it fixable.

## Goals

- Break handler god object into focused modules under `src/lib/code/`
- Extract shared types and state derivation for UI + backend
- Decouple Telegram notifications from session lifecycle
- Deduplicate start/resume handler logic (nearly identical)
- Clean up UI components to use shared state utilities
- No feature changes, no schema changes — structure only

## Current File Layout

```
src/lib/capabilities/code/
  index.ts          (210 lines) — capability definition + tool handlers
  executor.ts       (456 lines) — CLI process management
  worktree.ts       (220 lines) — git worktree isolation
  prompts.ts        (70 lines)  — system prompt builder

src/lib/action-cards/handlers/code.ts  (764 lines) — GOD OBJECT

src/app/api/code-sessions/create/route.ts       (58 lines)
src/app/api/code-sessions/[id]/respond/route.ts  (88 lines)
src/app/api/code-sessions/[id]/progress/route.ts (71 lines)
src/app/api/action-card/[id]/route.ts            (79 lines, shared)

src/app/code/code-sessions-client.tsx              (322 lines)
src/app/code/[id]/code-session-detail.tsx          (705 lines)
src/components/aurelius/cards/code-card.tsx         (193 lines)
```

## Target File Layout

```
src/lib/code/                          ← new domain module
  types.ts                             ← shared types (SessionState, CodeSessionData, CodeResult)
  state.ts                             ← state derivation (deriveSessionMode) + formatDuration
  session-manager.ts                   ← encapsulated singleton (activeSessions + telegram maps)
  telegram.ts                          ← format, keyboard, send/edit status messages
  executor.ts                          ← moved from capabilities/code/
  worktree.ts                          ← moved from capabilities/code/
  prompts.ts                           ← moved from capabilities/code/

src/lib/capabilities/code/index.ts     ← stays, imports from src/lib/code/
src/lib/action-cards/handlers/code.ts  ← thin registration, delegates to src/lib/code/ functions

UI: import shared types.ts + state.ts
API routes: minimal import updates
```

---

## Phase 1: Shared Types + State Utilities

**Create:** `src/lib/code/types.ts`, `src/lib/code/state.ts`

### types.ts — Shared types used across backend + frontend

```typescript
// Session states used by the executor runtime
export type SessionState = 'running' | 'waiting_for_input' | 'completed' | 'error';

// Session states stored in card data (broader — includes terminal states)
export type CodeSessionState =
  | 'running' | 'waiting' | 'completed'
  | 'merged' | 'rejected' | 'stopped' | 'error';

// UI display mode (derived from card status + session state)
export type SessionMode = 'loading' | 'pending' | 'running' | 'waiting' | 'completed' | 'error';

// Typed shape of the action card's JSONB data field for code cards
export interface CodeSessionData {
  sessionId: string;
  task: string;
  context?: string | null;
  branchName: string;
  worktreePath?: string;
  state?: CodeSessionState;
  lastMessage?: string;
  totalTurns?: number;
  totalCostUsd?: number | null;
  result?: CodeResult;
}

// Result gathered from worktree after session completes
export interface CodeResult {
  sessionId: string;
  turns: number;
  costUsd: number | null;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    summary: string;
  };
  changedFiles: string[];
  log: string;
}
```

### state.ts — Shared state derivation (eliminates 3 separate implementations)

Currently duplicated in:
- `code-session-detail.tsx` → `getMode()`
- `code-sessions-client.tsx` → `classifyCard()`
- `code-card.tsx` → inline status checks

```typescript
import type { SessionMode, CodeSessionData } from './types';

export function deriveSessionMode(cardStatus: string, data: CodeSessionData): SessionMode {
  if (cardStatus === 'error' || cardStatus === 'dismissed') return 'error';
  if (cardStatus === 'confirmed') {
    if (data.state === 'waiting') return 'waiting';
    if (data.state === 'completed') return 'completed';
    if (data.state === 'running') return 'running';
    return data.result ? 'completed' : 'running';
  }
  return 'pending';
}

export function formatDuration(ms: number): string {
  // Currently duplicated in code-card.tsx and code-sessions-client.tsx
}
```

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): extract shared types and state utilities"

---

## Phase 2: Move Foundation Files

**Move:** `src/lib/capabilities/code/{executor,worktree,prompts}.ts` → `src/lib/code/`
**Update:** All imports across the codebase

Files to update imports in:
- `src/lib/capabilities/code/index.ts` — imports executor, prompts
- `src/lib/action-cards/handlers/code.ts` — imports all three
- `src/app/api/code-sessions/create/route.ts` — imports slugifyTask from prompts
- `src/app/api/code-sessions/[id]/progress/route.ts` — references LOG_DIR pattern

The capability `index.ts` stays in `src/lib/capabilities/code/` (that's the convention) but all implementation moves to `src/lib/code/`.

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): move executor, worktree, prompts to src/lib/code/"

---

## Phase 3: Session Manager

**Create:** `src/lib/code/session-manager.ts`

Extract from `handlers/code.ts` (lines 20-62):
- `activeSessions` Map (globalThis-backed for HMR survival)
- `sessionTelegramMessages` Map
- `telegramToSession` Map
- `getActiveSessions()` with dead-session pruning
- SIGTERM handler registration
- `finalizeZombieSession()` (lines 729-763)

Public API:
```typescript
// Session tracking
getActiveSessions(): Map<string, ActiveSession>
getSession(sessionId: string): ActiveSession | undefined
setSession(sessionId: string, session: ActiveSession): void
removeSession(sessionId: string): void

// Telegram message mapping
getTelegramMessageId(sessionId: string): number | undefined
setTelegramMessage(sessionId: string, messageId: number): void
getSessionForTelegramMessage(messageId: number): string | undefined

// Cleanup
finalizeZombieSession(cardId: string): Promise<'completed' | 'error'>
```

**Update:** `handlers/code.ts` to import from session-manager
**Update:** `capabilities/code/index.ts` to import getActiveSessions from new location
**Update:** `api/code-sessions/[id]/respond/route.ts` to import from new location

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): extract session manager from handler"

---

## Phase 4: Telegram Module

**Create:** `src/lib/code/telegram.ts`

Extract from `handlers/code.ts` (lines 64-154):
- `getSessionKeyboard(state, cardId)` → inline keyboard buttons
- `formatSessionTelegram(state, task, turns, cost, extra)` → status message text
- `updateSessionTelegram(sessionId, text, keyboard)` → send or edit via client
- `notifySessionState(sessionId, state, cardId, data)` → convenience wrapper that calls format + update

This module imports from session-manager for the telegram message maps.

**Update:** `handlers/code.ts` to call `notifySessionState()` instead of inline telegram calls
**Update:** `telegram/handler.ts` if it imports telegram helpers from handlers/code.ts

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): extract Telegram notification module"

---

## Phase 5: Deduplicate + Slim Down Handlers

The `code:start` (lines 217-377) and `code:resume` (lines 572-716) handlers share ~80% of their code. Both:
1. Reserve session slot with placeholder
2. Build system prompt
3. Call `startSession()` with nearly identical callbacks
4. Replace placeholder with real session
5. Register process exit listener
6. Update card to running state
7. Send initial Telegram notification

**Extract:** `src/lib/code/lifecycle.ts`

```typescript
// Core session spawning logic shared between start and resume
export async function spawnSession(opts: {
  sessionId: string;
  task: string;
  context?: string;
  branchName: string;
  worktreePath: string;
  cardId?: string;
  cardData: Record<string, unknown>;
  isResume?: boolean;
  initialTurns?: number;
  initialCost?: number | null;
}): Promise<CardHandlerResult>
```

Also extract `finalizeSession()` (lines 161-211) into lifecycle.ts.

**Rewrite:** `handlers/code.ts` as thin handler registration:
- Each handler validates input, then calls lifecycle/approval functions
- Target: ~200 lines (down from 764)

Handler breakdown:
- `code:start` → validate → createWorktree → spawnSession
- `code:resume` → validate → check worktree exists → spawnSession (isResume: true)
- `code:respond` → validate → session.sendMessage → update card + telegram
- `code:finish` → validate → session.closeInput
- `code:stop` → validate → session.kill → cleanup worktree → update card
- `code:approve` → mergeWorktree → update card state
- `code:reject` → cleanupWorktree → update card state

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): deduplicate handlers, extract lifecycle module"

---

## Phase 6: Clean Up UI Components

### code-session-detail.tsx (705 → ~550 lines)
- Import `SessionMode`, `CodeSessionData`, `CodeResult` from `@/lib/code/types`
- Replace `getMode()` with `deriveSessionMode()` from `@/lib/code/state`
- Remove local `SessionMode` type definition
- Remove local `formatDuration` if used

### code-card.tsx (193 → ~150 lines)
- Import `CodeResult`, `CodeSessionData` from `@/lib/code/types`
- Remove local `CodeResult` interface
- Remove local `formatDuration`
- Use typed `CodeSessionData` instead of inline type assertion

### code-sessions-client.tsx (322 → ~280 lines)
- Import `deriveSessionMode` from `@/lib/code/state`
- Replace `classifyCard()` with mapping from SessionMode to group
- Import `formatDuration` from `@/lib/code/state`
- Remove local `formatDuration`

**Verify:** `npx tsc --noEmit`
**Commit:** "refactor(code): clean up UI with shared types and state"

---

## Phase 7: Final Verification

1. `npx tsc --noEmit` — clean TypeScript
2. `npx vitest run` — all existing tests pass (no code tests exist yet, but ensure nothing else broke)
3. Manual smoke test: navigate to /code, verify session list renders, check card rendering in chat

---

## File Impact Summary

### New files (7)
- `src/lib/code/types.ts`
- `src/lib/code/state.ts`
- `src/lib/code/session-manager.ts`
- `src/lib/code/telegram.ts`
- `src/lib/code/lifecycle.ts`
- `src/lib/code/executor.ts` (moved)
- `src/lib/code/worktree.ts` (moved)
- `src/lib/code/prompts.ts` (moved)

### Modified files (8)
- `src/lib/capabilities/code/index.ts` — import updates
- `src/lib/action-cards/handlers/code.ts` — slim to ~200 lines
- `src/app/api/code-sessions/create/route.ts` — import update
- `src/app/api/code-sessions/[id]/respond/route.ts` — import update
- `src/app/api/code-sessions/[id]/progress/route.ts` — import update
- `src/app/code/[id]/code-session-detail.tsx` — use shared types/state
- `src/app/code/code-sessions-client.tsx` — use shared types/state
- `src/components/aurelius/cards/code-card.tsx` — use shared types

### Deleted files (3)
- `src/lib/capabilities/code/executor.ts` (moved)
- `src/lib/capabilities/code/worktree.ts` (moved)
- `src/lib/capabilities/code/prompts.ts` (moved)

### Line count impact
- Before: ~2,730 lines across 10 files (handler: 764, detail: 705)
- After: ~2,400 lines across 15 files (no file > 500 lines, handler: ~200)
- Net: ~330 lines removed via deduplication
