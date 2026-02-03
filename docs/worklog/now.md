# Current Focus

> **Always check this file at session start.**

## Just Completed (Last Session)

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

## In Progress

Ready to merge `feature/gmail-connector` to main.

## Up Next

- [ ] Test Gmail sync with real inbox
- [ ] Add UI components for Gmail-specific features (thread expand/collapse)
- [ ] Consider: Linear connector (similar pattern)

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- Memory: Dual storage systems (DB + file) not fully synchronized
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
