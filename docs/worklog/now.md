# Current Focus

> **Always check this file at session start.**

## Just Completed (Last Session)

**2026-02-03 Night**

Gmail Connector Implementation:
- **Full Gmail connector** on `feature/gmail-connector` branch (14 commits)
- **Core modules**:
  - `src/lib/gmail/types.ts` - TypeScript types for Gmail data
  - `src/lib/gmail/client.ts` - Gmail API with Service Account auth
  - `src/lib/gmail/sync.ts` - Sync logic with smart sender analysis
  - `src/lib/gmail/actions.ts` - Archive, spam, reply, unsubscribe
- **API endpoints**:
  - `POST/GET /api/gmail/sync` - Manual sync trigger
  - `POST /api/gmail/reply` - Create reply drafts or send
- **Smart features**:
  - Sender tags: Internal, Direct, CC, Auto, Newsletter, Group, Suspicious
  - Phishing detection: brand impersonation, lookalike domains, urgency patterns
  - Gravatar avatars
  - Thread deduplication
- **Integrations**:
  - Heartbeat syncs Gmail (Step 3)
  - Triage archive/spam actions sync back to Gmail
- **Test suite**: 36 tests covering sync, actions, phishing detection
- **Docs**: Updated `docs/connectors/gmail.md`, `.env.example`

**2026-02-03 Early AM**

Smart Entity Resolution System (merged to main):
- Multi-signal entity matching with weighted scoring
- Partial name matching, cross-type protection
- Batch/fact deduplication, location/term filtering
- Comprehensive test suite (24 tests, 87.5% pass)

## In Progress

On `feature/gmail-connector`:
- Core implementation complete ✓
- Tests passing ✓
- Ready for merge to main

## Up Next

- [ ] Merge `feature/gmail-connector` to main
- [ ] Test Gmail sync with real inbox
- [ ] Add UI components for Gmail-specific features
- [ ] Consider: Linear connector (similar pattern)

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- Memory: Dual storage systems (DB + file) not fully synchronized
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
