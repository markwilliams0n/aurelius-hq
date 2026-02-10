# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-09**

Code agent refactor (feature/refactor-code-agent → main, PR #24, PER-233):
- Decomposed 764-line god object (`handlers/code.ts`) into 8 focused modules under `src/lib/code/`
- New: types.ts, state.ts, session-manager.ts, telegram.ts, lifecycle.ts
- Moved: executor.ts, worktree.ts, prompts.ts from capabilities/code/ to lib/code/
- Shared `spawnSession()` replaces duplicated start/resume logic
- UI components now use shared types + `deriveSessionMode` (fixes "Needs Response" in list)
- Migrated telegram/handler.ts from raw Map to function API, fixed stale test mocks
- handlers/code.ts: 764 → 286 lines, 4 commits, 283 tests pass

Triage refactor (PR #22, PER-230) + Chat refactor (PR #23, PER-232):
- Triage: 8-phase cleanup, separated classify/rules/connectors/sync
- Chat: shared utilities, structured events, O(1) dispatch, TTL caching, bug fixes

## In Progress

Nothing active — clean slate.

## Up Next

- [ ] **Investigate 15 remaining skipped Gmail threads** — items archived in triage but still in Gmail inbox
- [ ] **Test aurelius-can-code end-to-end** — manual smoke test with real coding task
- [ ] **Test vault end-to-end** (PER-200) — manual testing of all vault functionality
- [ ] **Phase 2: Telegram control plane** — inline keyboards, callback queries, reply-to-session
- [ ] **Phase 3: Memory integration** — Supermemory summaries on start/complete/approve
- [ ] **Linear: move PER-233 to Done** — auth expired, needs `/trg-linear:setup`

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- OpenRouter credits low — learning step failing (needs top-up)
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
