# Recent Work

Work completed in the last 2-4 weeks.

---

## 2026-02-09

Code agent refactor (feature/refactor-code-agent → main, PR #24, PER-233):
- Decomposed 764-line god object into 8 focused modules under `src/lib/code/`
- Shared `spawnSession()` replaces duplicated start/resume logic
- handlers/code.ts: 764 → 286 lines, 283 tests pass

Triage refactor (PR #22, PER-230) + Chat refactor (PR #23, PER-232):
- Triage: 8-phase cleanup, separated classify/rules/connectors/sync
- Chat: shared utilities, structured events, O(1) dispatch, TTL caching

## 2026-02-08

### Backlog Sweep (overnight autonomous session)
- PER-199: Fixed 32 TypeScript errors (stale test fixtures, type mismatches)
- PER-210: Linear `create_task` → action card approval flow
- PER-187: Triage sender context (items aware of same-sender history)
- PER-177: Dynamic cortex topology — derived from capability registry + DB
- PER-206: Vault wizard — confirmed all 8 plan tasks already implemented, closed
- PER-149: macOS native notifications alongside Telegram (osascript)
- PER-211: Gmail agent capability with `draft_email` tool + action card approval
- PER-209, PER-207, PER-178: Closed — already done

### Aurelius Can Code (PR #19, PER-213)
- `code` capability with `start_coding_session` tool
- Executor spawns `claude -p` with NDJSON stream parsing, worktree isolation
- Action card approval flow with code card UI (4 states)

### Pending Actions Page (PR #18, PER-174)
- `/actions` page with grouped pending cards, sidebar badge, 30s polling

## 2026-02-07

### Unified Chat Across App (PER-188)
- `useChat` hook — single shared engine for all chat surfaces (streaming, action cards, persistence)
- `ChatContext` type — surface-specific context injection (triage item, page context, overrides)
- All 3 web surfaces (main chat, triage modal, Cmd+K panel) unified on one API
- Triage chat gained: streaming, real tools, markdown, action cards, per-item persistence
- chat-client.tsx reduced 57% (575 → 248 lines)
- Memory extraction respects overrides (e.g. skipSupermemory)

### Triage Enhancements (PER-170–176)
- List view with multi-select bulk archive, keyboard nav
- "Action Needed" Gmail label with 3-day snooze
- Rich approval card renderers (Gmail + Linear) with inline editing
- `T` shortcut creates Linear issue via action card
- CC recipients on Gmail cards, external links open in new tab

### Cortex Neural Map
- Interactive React Flow graph of all Aurelius systems
- `system_events` table + topology API with live stats
- Custom pulse edge animations, filter toggles, detail panel

### Global Action Card System (PER-172–176)
- Refactored from Slack-specific to generic pattern-based containers
- 4 patterns: approval, config, confirmation, info
- DB persistence, handler registry (Slack, Gmail, Linear, Config)
- show_config_card tool for inline config editing

### Slack Sending with Action Cards
- Slack directory cache with daily sync via heartbeat
- send_slack_message agent capability
- DMs as group DM or 1:1, channels with auto-join + @mention cc
- Markdown rendering in chat (react-markdown + remark-gfm)

## 2026-02-06

### Linear Task Management & Agent Capabilities
- Task management page with Linear integration
- Agent capability system — tools for create/update/list/get tasks via chat
- Fixed triage→Linear task creation, identifier lookup, team visibility
- Prompt version propagation for auto-upgrading DB prompts

### Linear Triage Improvements
- Contextual notification previews, project labels, self-action filtering
- Fixed notification auth (personal key for inbox, bot token for task mgmt)

## 2026-02-05

### Heartbeat & System Page
- Streaming heartbeat progress via SSE
- Gmail inbox reconciliation on heartbeat
- Rich expanded heartbeat details
- Triage actions hidden from System feed by default

### Memory Debug Mode
- Full memory event instrumentation across all operations
- CMD+D overlay panel with live SSE streaming
- Debug feed tab on Memory page

### Slack Connector
- Real-time Socket Mode integration
- DMs, @mentions, triage channel auto-capture
- Thread capture, AI summaries via Ollama
- Task extraction, user instructions

## 2026-02-03

### Gmail Connector (Full Implementation)
- **Core sync**: Service Account auth, fetch unarchived emails, content mapping
- **Smart features**: Sender tags (Internal, Direct, CC, Auto, Newsletter, Suspicious), phishing detection, Gravatar avatars
- **Actions**: Archive (bi-directional), Reply (drafts), Spam, Unsubscribe
- **Heartbeat integration**: Auto-sync during heartbeat cycle
- **Test suite**: 36 tests covering sync, actions, phishing detection

### Memory System Fixes
- **Pre-extracted content**: Heartbeat parses `**Memory Saved:**` sections from daily notes
- **Redundancy detection**: Fixed over-aggressive LLM checks, now string-based (>85% similarity)
- **QMD indexing**: Facts now included in `summary.md` for search
- **Shared context**: Triage chat uses `buildAgentContext` like main chat

### Smart Entity Resolution (merged to main)
- Multi-signal entity matching with weighted scoring
- Partial name matching, cross-type protection
- Batch/fact deduplication, location/term filtering
- Comprehensive test suite (24 tests)

### UI Fixes
- Triage cards scroll properly when tasks overflow (`overflow-y-auto`)

---

## 2026-02-02

### Triage Enhancements
- **Suggested Tasks** - AI extracts action items from all triage items
  - "For You" / "For Others" sections below triage card
  - Accept (✓) creates memory fact, Dismiss (✗) removes
  - Archive auto-dismisses remaining tasks
- **Snooze Shortcut** - Press `s` for preset snooze options
  - 1 hour, 3 hours, tomorrow 9 AM, next Monday, first of month
  - Items hidden until snooze expires, then auto-wake
- **Memory + Archive** - `Shift+↑` saves to memory then archives

### Granola Connector (Full Implementation)
- Complete sync with Granola API
- Auto memory extraction during sync (entities, facts, action items)
- Task extraction from meeting action items
- Backfill script for existing items (created 168 tasks)

### Documentation
- `docs/systems/triage.md` - Triage system overview
- `docs/connectors/index.md` - Connector registry
- `docs/connectors/granola.md` - Granola connector docs
- `docs/connectors/README.md` - Connector setup wizard

### Skills Created
- `/new-connector` - Guided connector design brainstorming
- `/new-feature` - Create feature branch
- `/switch-branch` - Smart branch switching
- `/finish-feature` - Merge feature to main

### Infrastructure
- Migrated triage API from in-memory to database
- Added `suggested_tasks` table with cascade delete
- Database-backed snooze with auto-wake on GET

---

## 2026-02-01

### Triage System (Phase 2)
- Unified inbox for gmail, slack, linear, granola, manual
- Keyboard-driven workflow (←↑→↓ for actions)
- AI enrichment with memory linking
- Sidebar with stats, context, sender info

### Memory System (Phase 2)
- Documents table for ingested content
- Memory browser UI
- Fact extraction from documents
- Entity linking

### Chat System (Phase 3)
- Cmd+K chat panel
- Context-aware conversations
- Triage item chat overlay

### Foundation (Phase 1)
- Next.js 16 + TypeScript + Tailwind
- Drizzle ORM with PostgreSQL
- Magic link authentication
- Config versioning system
- Activity logging

---

**Full history:** [changelog.md](./changelog.md)
