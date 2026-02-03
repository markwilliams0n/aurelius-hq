# Current Focus

> **Always check this file at session start.**

## Just Completed (Last Session)

**2026-02-03 Early AM**

Smart Entity Resolution System:
- **New `entity-resolution.ts`** - Multi-signal entity matching with weighted scoring:
  - Name similarity (50%): exact match, prefix, abbreviation
  - Context overlap (35%): shared keywords between content and entity facts
  - Recency/decay (15%): recently accessed entities rank higher
- **Partial name matching**: "Adam" → "Adam Watson" when context aligns
- **Cross-type protection**: Won't create "Adam Watson" as company if person exists
- **Batch deduplication**: Multiple mentions in one note → one entity
- **Fact deduplication**: Redundant facts (same info rephrased) skipped
- **Location/term filtering**: San Diego, Austin, AI, ML filtered out
- **Comprehensive test suite**: `scripts/test-heartbeat-scenarios.ts` (24 tests, 87.5% pass)
- **Updated heartbeat docs**: `docs/systems/heartbeat.md` with entity resolution details

**2026-02-02 Night (earlier)**

Memory System Improvements:
- Fixed QMD search showing git diff markers
- Added Ollama semantic extraction for chat → daily notes
- Improved triage note formatting
- Added synthesis scheduling (daily at 3 AM)
- Fixed agent not seeing daily notes
- Fixed Telegram bot missing daily notes
- Centralized agent context (`buildAgentContext()`)
- Improved search results UI with clickable results
- Type filter for search
- Comprehensive memory system review

## In Progress

On `feature/memory-bot-tuning`:
- Entity resolution system complete ✓
- Ready for merge to main

## Up Next

- [ ] Merge feature branch to main
- [ ] Test memory system for a few days
- [ ] Consider: Heartbeat → DB sync (future)
- [ ] Proactive work in heartbeat (future - sequence before memory backup)

## Known Issues (Documented)

- Dual storage systems (DB + file) not fully synchronized
- Heartbeat extracts to file system only, not database
- 3 edge cases in entity resolution tests (12.5% fail rate):
  - "Adam Johnson" not always created as separate person
  - StubHub duplicate on reprocessing historical notes
  - Cross-type pollution (adam-watson as project exists)
- See `docs/plans/2026-02-02-memory-system-review.md` for full analysis

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
