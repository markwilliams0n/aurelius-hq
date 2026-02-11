# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-10**

Autonomous code agent design (PER-236):
- Researched OpenHands, Claude Code headless, SWE-agent, Devin, Cursor background agents, GitHub Copilot agent
- Designed two-phase autonomous flow: read-only planning → headless execution with `--dangerously-skip-permissions`
- 20-min auto-approve on plans, GitHub PRs as output, dual trigger (user command + heartbeat)
- Configurable via `capability:code-agent` config key (cost/time ceilings, allowed tools, heartbeat toggle)
- Design doc: `docs/plans/2026-02-10-autonomous-code-agent-design.md`

Telegram coding session fixes (PER-234):
- New messages (not silent edits) for waiting state — user actually gets notified
- Reply hint always shows, Finish button added to waiting keyboard
- lastMessage fallback for tool-only turns, Telegram replies sync card state

Web browser capability (PER-235):
- 6 tools: web_open, web_snapshot, web_get_text, web_click, web_fill, web_screenshot
- Wraps `agent-browser` CLI with per-conversation sessions
- Code agent also gets `Bash(npx agent-browser:*)` access
- DB migration: `capability:browser` config key

Cleanup:
- Removed 2 stale worktrees + 2 orphaned branches (already merged code agent work)
- Deleted 11 old coding session cards from DB

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

- [ ] **Implement autonomous code agent** (PER-236) — plan → execute → PR workflow per design doc
- [ ] **Investigate 15 remaining skipped Gmail threads** — items archived in triage but still in Gmail inbox
- [ ] **Test coding sessions end-to-end** — verify Telegram notification flow with the fixes
- [ ] **Test vault end-to-end** (PER-200) — manual testing of all vault functionality
- [ ] **Phase 3: Memory integration** — Supermemory summaries on start/complete/approve

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- OpenRouter credits low — learning step failing (needs top-up)
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
