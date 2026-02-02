# Recent Work

Work completed in the last 2-4 weeks.

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
- `docs/triage.md` - Triage system overview
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
