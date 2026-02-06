# Current Focus

> **Always check this file at session start.**

## Just Completed (Last Session)

**2026-02-05 (Continued)**

Heartbeat & System Page:
- Fixed scheduled heartbeats invisible on System page (was logging to file, now logs to DB)
- Streaming heartbeat progress via SSE — live ticker shows each step as it runs
- Gmail inbox reconciliation on heartbeat — auto-archives stale triage items
- Rich expanded heartbeat details: step breakdown with timing, connector stats, expandable entities/facts, warnings
- Triage actions hidden from System feed by default (toggle to show)
- PR #5 merged to main

**2026-02-05**

Slack Connector:
- Real-time integration via Socket Mode (WebSocket)
- DMs, @mentions, triage channel auto-capture
- Full thread capture when @mentioned in thread
- AI summaries via Ollama (local LLM)
- Task extraction defaulting to "For You"
- User instructions: "@aurelius make a task to..." works
- Code review fixes: TTLs on caches, rate limit batching
- Full documentation in docs/connectors/slack.md

**2026-02-03 (Continued)**

Linear Connector:
- Full Linear integration via GraphQL API
- Notification sync via heartbeat (same pattern as Gmail)
- Archive syncs back to Linear (marks as read)
- `L` keyboard shortcut to open in Linear (list + modal)
- Rich metadata display: state, priority, project, labels, actor
- Documentation + design docs

**2026-02-03 Night**

Gmail Connector + Memory System Fixes:
- **Gmail connector** complete with all core features:
  - Service Account auth with domain-wide delegation
  - Smart sender tags (Internal, Direct, CC, Auto, Newsletter, Suspicious)
  - Phishing detection (brand impersonation, lookalike domains)
  - Bi-directional sync (archive/spam sync back to Gmail)
  - Reply support (drafts, with optional direct send)
  - Heartbeat integration for auto-sync
  - 36 tests covering sync, actions, phishing detection

- **Memory system fixes**:
  - Heartbeat now processes pre-extracted content from daily notes
  - Fixed over-aggressive redundancy detection (string-based instead of LLM)
  - QMD search now indexes facts from summary.md
  - Triage chat uses shared context builder (no more hallucinations)

- **UI fixes**:
  - Triage cards scroll properly when tasks overflow

## Just Completed

**2026-02-06 (Evening)**

Linear Triage Improvements (feature/triage-improvements):
- Contextual previews: "Katie moved to In Progress — ..." instead of "Katie changed status"
- Project notifications labeled clearly (project update, project deleted)
- Self-action filtering (your own Linear actions don't create triage items)
- Fixed notification auth: personal API key for inbox, bot token for task mgmt
- Better sender attribution when actor is null (falls back to issue creator)

**2026-02-06**

Linear Task Management & Agent Capabilities:
- PR #7: Task management page with Linear integration
- PR #8: Triage performance, sync reconciliation, task creation from triage
- PR #9: Agent capability system — tools for create/update/list/get tasks via chat
- Fixed triage→Linear task creation (assignee, default team, error surfacing)
- Fixed identifier lookup (PER-123) — was silently failing due to invalid Linear filter
- Fixed agent team visibility (shows all 22 teams, defaults assignment to Mark)
- Added prompt version propagation so code prompt changes auto-upgrade DB
- Cleaned up all stale branches and worktrees

**2026-02-05 (Evening)**

Memory Debug Mode:
- Full memory event instrumentation across all memory operations (recall, extract, save, search, reindex)
- CMD+D overlay panel with live SSE streaming of events
- Expandable event cards with payload, reasoning, evaluation details
- Debug mode toggle with pulsing sidebar indicator
- Debug feed tab on Memory page (filters, search, day grouping)
- Ollama extraction prompts now include reasoning fields
- Debug evaluator module (standalone, not yet wired into flow)
- Bug fixes: event ID consistency, SSE listener leak, duplicate events, reconnection, buffer fallback to DB

## In Progress

Nothing active - ready for next task.

## Up Next

- [x] **Linear triage reconciliation** — done, auto-archives when read/archived in Linear
- [ ] **Connector-aware memory extraction** — `extractEmailMemory` is used for ALL connectors but the prompt is email-specific. Granola transcripts get treated as emails (wrong summary framing, extracts random metrics, misses meeting decisions/commitments). Need either separate prompts per connector type or a connector-aware prompt that adjusts for meetings vs emails vs slack. Key file: `src/lib/memory/ollama.ts:extractEmailMemory`
- [ ] Test Gmail sync with real inbox
- [ ] Add UI components for Gmail-specific features (thread expand/collapse)

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
