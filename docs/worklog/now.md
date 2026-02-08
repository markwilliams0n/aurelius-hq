# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-08**

Supermemory ChatGPT Import:
- Imported 252 memories from ChatGPT history export into Supermemory
- Fixed timestamps (original file had all items dated to export day; mapped `original_date_tag` to real dates)
- Removed 1 duplicate, final count: 252 items (~7.5K content tokens, 3% of free tier)
- Research: Supermemory decay is semantic (static/dynamic), not time-based — no backdating API exists
- Manifest with all IDs saved for rollback: `docs/research/supermemory-import-manifest.json`
- Import script: `scripts/import-chatgpt-to-supermemory.ts` (supports `--dry-run` and `--rollback`)

**2026-02-07**

Vault Bug Fixes & Code Review (feature/vault-fixes → main, PR #17, PER-208):
- Fixed promptVersion caching — agent now calls vault tools via Telegram
- Fixed content truncation — long docs no longer silently replaced by LLM summary
- Fixed `to_tsquery` → `plainto_tsquery` for safe dedup search
- Improved Jaccard dedup: stop-word filtering, title+snippet comparison, raised threshold to 0.5
- Added type validation in `update_vault_item` handler
- Added delete confirmation flow (action card `confirmMessage` pattern)
- Fixed wizard save ignoring user edits to Content textarea
- Renamed misleading "Summary" label to "Content" in wizard

Vault PR Review & Merge (docs/memory-seed → main):
- Reviewed PR #16 (Personal Vault — 37 files, +6156 lines)
- Fixed 3 critical issues (UUID conversation ID, overly broad sensitive pattern, PDF extraction crash)
- Fixed 6 important issues (UUID validation on API routes, upload validation, Ollama redaction, proper vault CardPattern with DB migration)
- Fixed 3 minor issues (deduplicated TYPE_ICONS, getAllTags cast, refreshItems deps)
- DB migration applied (vault_items table, card_pattern + config_key enum values)

**2026-02-07 (Earlier)**

Unified Chat Across App (feature/chat-across-app, merged to main):
- `useChat` hook — single shared engine for all chat surfaces (394 lines)
- `ChatContext` type — surface-specific context injection (triage item, page context, overrides)
- All 3 web surfaces (main chat, triage modal, Cmd+K panel) unified on `/api/chat`
- PER-188 + 10 sub-issues (PER-189–198) all Done

## In Progress

Nothing — main is clean.

## Up Next

- [x] ~~**Triage chat memory → Supermemory**~~ — fixed by unified chat (triage now uses `/api/chat` → `extractAndSaveMemories`)
- [x] ~~**Test vault feature**~~ — tested via PER-208 bug fixing session (save, search, update, dedup, content preservation all verified)
- [ ] **Fix 32 pre-existing TypeScript errors** (PER-199) — stale test fixtures and minor type mismatches
- [ ] **Migrate task-creator-panel off legacy `/api/triage/chat`** — last consumer of old route
- [ ] **Action Cards notification tray** (PER-174) — global view of pending cards outside chat (low priority, deferred)
- [ ] **Connector-aware memory extraction** — `extractEmailMemory` is used for ALL connectors but the prompt is email-specific. Need connector-aware prompts. Key file: `src/lib/memory/ollama.ts:extractEmailMemory`
- [ ] Test Gmail sync with real inbox
- [ ] **Test triage enhancements** (PER-178) — full manual test plan with sub-issues in Linear

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
