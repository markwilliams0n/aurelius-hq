# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-10**

Autonomous code agent implemented + merged (PER-236):
- Researched OpenHands, Devin, SWE-agent, Cursor, Claude Code headless, GitHub Copilot agent
- Two-phase: read-only planning → headless execution with `--dangerously-skip-permissions`
- 20-min auto-approve on plans, GitHub PRs as output via `gh pr create`
- Approve/reject buttons merge/close PRs via `gh` CLI
- `capability:code-agent` config key ($5 plan ceiling, $20 execution ceiling, 120min max)
- Telegram notifications: Planning → Plan Ready (with approve buttons) → Executing → PR Ready
- Tested end-to-end via Telegram — PR created, merged, worktree cleaned up
- 11 files, +1016 lines, 283 tests passing

Telegram coding session fixes (PER-234):
- New messages (not silent edits) for waiting state — user actually gets notified
- Reply hint always shows, Finish button added to waiting keyboard

Web browser capability (PER-235):
- 6 tools wrapping `agent-browser` CLI with per-conversation sessions

## In Progress

Nothing active — clean slate.

## Up Next

- [ ] **Autonomous agent follow-up** — heartbeat integration (auto-pickup Linear issues), config seeding, web UI for plan display + PR link
- [ ] **Investigate 15 remaining skipped Gmail threads** — items archived in triage but still in Gmail inbox
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
