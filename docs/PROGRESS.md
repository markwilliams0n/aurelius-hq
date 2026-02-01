# Aurelius Development Progress

## Phase 1: Foundation ✅ COMPLETE

**Completed:** 2026-02-01

### What's Built

| Component | Status | Notes |
|-----------|--------|-------|
| Next.js 16 + TypeScript | ✅ | App Router, src/ structure |
| Tailwind + shadcn/ui | ✅ | Dark/gold Aurelius theme |
| Custom fonts | ✅ | Inter, Playfair Display, JetBrains Mono |
| Railway Postgres | ✅ | 5 tables created |
| Drizzle ORM | ✅ | Schema with migrations |
| Magic link auth | ✅ | Send, verify, session management |
| Session middleware | ✅ | Protected routes |
| Config versioning | ✅ | soul, agents, processes seeded |
| Activity logging | ✅ | Audit trail for all events |
| Landing page | ✅ | Auth-aware with nav cards |
| Config API | ✅ | GET/PUT with version history |

### Database Tables

- `users` - User accounts
- `sessions` - Session tokens with expiry
- `magic_links` - Single-use auth tokens
- `configs` - Versioned markdown configs
- `activity_log` - System audit trail

### API Endpoints

- `POST /api/auth/send-magic-link` - Request login link
- `GET /api/auth/verify?token=` - Verify and create session
- `POST /api/auth/logout` - Destroy session
- `GET /api/config/[key]` - Get config (soul/agents/processes)
- `GET /api/config/[key]?history=true` - Get version history
- `PUT /api/config/[key]` - Update config (creates new version)

### Commits (15 total)

1. `616b4b6` - Initialize Next.js 14 with TypeScript and Tailwind
2. `447525a` - Add drizzle, shadcn/ui, resend, anthropic SDK
3. `5422cf9` - Configure Aurelius dark/gold theme with custom fonts
4. `5b0c97a` - Add Drizzle schema for auth
5. `cff5f70` - Add timezone support to timestamp fields
6. `4d3a86f` - Add config and activity_log schema
7. `fef2877` - Add unique constraint on (key, version) in configs
8. `6fb34e6` - Add initial database migration
9. `ba39621` - Add activity logger utility
10. `378df5f` - Add magic link auth - send link flow
11. `bd1bf8e` - Add magic link verification and session middleware
12. `8b6cc5b` - Add config seeds and seed script
13. `f4a3054` - Add landing page with auth status and navigation cards
14. `b6a1804` - Add config API endpoints with version history
15. `a0da046` - Use port 3333 for local development

---

## Phase 2: Memory + Chat 🔄 IN PROGRESS

**Target Components:**
- [ ] Entities table (people, teams, projects, companies, documents, topics)
- [ ] Facts table (atomic facts with embeddings)
- [ ] Documents table (original content storage)
- [ ] Document chunks table (for vector search)
- [ ] Claude Max integration
- [ ] Chat page (full-screen)
- [ ] Memory extraction via chat
- [ ] JSON document ingestion CLI
- [ ] Vector embeddings (pgvector)
- [ ] Memory browser UI

---

## Phase 3: Chat Polish

**Target Components:**
- [ ] Slide-out panel (Cmd+K)
- [ ] Context compaction
- [ ] Config changes via chat (approval flow)
- [ ] @ mentions for entities

---

## Phase 4: Connectors + Triage

**Target Components:**
- [ ] Gmail connector
- [ ] Enrichment pipeline
- [ ] Triage UI (cards, arrows, AI intel, undo)
- [ ] Triage rules engine
- [ ] Linear connector

---

## Phase 5: Actions + Background

**Target Components:**
- [ ] Tasks table
- [ ] Action list UI
- [ ] Task creation from triage
- [ ] Background worker
- [ ] Settings UI

---

## Local Development

```bash
cd /Users/markwilliamson/Claude\ Code/aurelius-hq
pnpm dev
# → http://localhost:3333
```

Admin email: `mark@rostr.cc`
