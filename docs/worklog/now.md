# Current Focus

> **Always check this file at session start.**

## Just Completed

**2026-02-07 (Late Night)**

Unified Chat Across App (feature/chat-across-app, merged to main):
- `useChat` hook — single shared engine for all chat surfaces (394 lines)
- `ChatContext` type — surface-specific context injection (triage item, page context, overrides)
- All 3 web surfaces (main chat, triage modal, Cmd+K panel) unified on `/api/chat`
- Triage chat gained: streaming, real tools, markdown, action cards, per-item persistence
- chat-client.tsx reduced 57% (575 → 248 lines)
- Memory extraction respects `overrides.skipSupermemory`
- Bugfix: triage-client remaps item.id to externalId — added `dbId` for conversation persistence
- PER-188 + 10 sub-issues (PER-189–198) all Done

## In Progress

Nothing — main is clean.

## Up Next

- [x] ~~**Triage chat memory → Supermemory**~~ — fixed by unified chat (triage now uses `/api/chat` → `extractAndSaveMemories`)
- [ ] **Migrate task-creator-panel off legacy `/api/triage/chat`** — last consumer of old route
- [ ] **Action Cards notification tray** (PER-174) — global view of pending cards outside chat (low priority, deferred)
- [ ] **Connector-aware memory extraction** — `extractEmailMemory` is used for ALL connectors but the prompt is email-specific. Need connector-aware prompts. Key file: `src/lib/memory/ollama.ts:extractEmailMemory`
- [ ] Test Gmail sync with real inbox
- [ ] Add UI components for Gmail-specific features (thread expand/collapse)
- [ ] **Test triage enhancements** (PER-178) — full manual test plan with sub-issues in Linear

## Known Issues (Documented)

- Gmail: `GMAIL_ENABLE_SEND=true` required to send (drafts by default)
- Gmail: Service Account needs domain-wide delegation setup
- Memory: 3 edge cases in entity resolution tests (12.5% fail rate)

---

**Looking back:** [recent.md](./recent.md) for last few weeks
**Looking forward:** [../roadmap/next.md](../roadmap/next.md) for upcoming plans
