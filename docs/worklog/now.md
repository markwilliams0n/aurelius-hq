# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-09**

Gmail sync & triage reliability fixes (feature/follow-up-enhancement → main, PR #21, PER-229):
- Gmail archive/spam now uses `threads.modify` (was per-message, didn't work for multi-message threads)
- Retroactive cleanup: archived 23 stale Gmail threads stuck in inbox
- Dedup prevention: unique index on (connector, external_id) + onConflictDoNothing
- All triage API calls use `dbId` (was using remapped `externalId`, causing 404s)
- Batch card checked state re-syncs on item changes (stale-while-revalidate fix)
- `handleActionNeeded` awaits API before removing from state (race condition fix)
- `reclassifyNullBatchItems` respects user "remove from group" decisions
- 261 tests pass, TypeScript clean

Smart triage classification & batch actions (feature/triage-enhancements → main, PR #20, PER-219):
- 3-pass classification pipeline: rules → Ollama → Kimi (cloud LLM via OpenRouter)
- Batch card UI with domain groups (notifications, finance, newsletters, calendar, spam)
- Rule system with CRUD, auto-creation on reclassify, NL parsing
- Individual item classify via `g` shortcut + action menu number keys
- Calendar "Accept & Archive", daily learning loop, AI cost logging
- Bug fixes: Gmail sync on batch archive, reappearing items after uncheck, SQL injection, OpenRouter max_tokens
- 25 commits, 41 files, +7,500 lines

Test suite fix (feature/test-fixes branch, PER-218):
- Fixed 39 failing tests across 7 test files — all caused by implementation drift
- 260/260 tests now pass, TypeScript clean

**2026-02-08 (overnight session)**

Backlog sweep — worked through Linear project issues autonomously:
- PER-199: Fixed 32 TypeScript errors (stale test fixtures, type mismatches)
- PER-210: Linear `create_task` → action card approval flow
- PER-187: Triage sender context (items aware of same-sender history)
- PER-177: Dynamic cortex topology — derived from capability registry + DB instead of hardcoded
- PER-206: Vault wizard — confirmed all 8 plan tasks already implemented, closed
- PER-149: macOS native notifications alongside Telegram (osascript)
- PER-211: Gmail agent capability with `draft_email` tool + action card approval
- PER-209: Parent issue closed — all agent actions now use action card flow (Slack, Linear, Gmail)
- PER-207: Linear hooks & statusline — already done, closed
- PER-178: Triage enhancements test plan — branch already merged, closed with all 8 children

**2026-02-08 (earlier)**

Aurelius Can Code (feature/aurelius-can-code → main, PR #19, PER-213):
- `code` capability with `start_coding_session` tool
- Executor spawns `claude -p` with NDJSON stream parsing, worktree isolation
- Action card approval flow with code card UI (4 states)
- 16 files, +1,919 lines, 11 commits

Pending Actions Page (PR #18, PER-174):
- `/actions` page with grouped pending cards, sidebar badge, 30s polling

## In Progress

Nothing active — clean slate.

## Up Next

- [x] **Test triage pipeline end-to-end** — Gmail sync verified working, batch groups forming, rules applying
- [ ] **Investigate 15 remaining skipped Gmail threads** — items archived in triage but still in Gmail inbox
- [ ] **Test aurelius-can-code end-to-end** — manual smoke test with real coding task
- [ ] **Test vault end-to-end** (PER-200) — manual testing of all vault functionality
- [ ] **Phase 2: Telegram control plane** — inline keyboards, callback queries, reply-to-session
- [ ] **Phase 3: Memory integration** — Supermemory summaries on start/complete/approve

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- OpenRouter credits low — learning step failing (needs top-up)
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
