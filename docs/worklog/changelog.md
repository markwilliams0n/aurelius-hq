# Changelog

Complete history of all work done on Aurelius HQ.

---

## 2026-02-02

### Features
- `a03a10e` feat: add suggested tasks, snooze, and Granola memory extraction
- `8100dd3` feat: add /new-connector skill for guided connector setup
- `d86c936` feat: add git branching workflow skills

### Documentation
- `4b210b0` docs: add connector registry with status and capabilities
- `c45afcd` docs: add suggested tasks extraction design

### Fixes
- `f7a0af5` fix: correct Granola API integration based on actual response structure

### Data
- `f5e42c3` data: update entity data from Granola memory extraction

---

## 2026-02-01

### Features
- `69763ab` feat: add Granola meeting notes integration
- `ec2ba7e` feat: add Cmd+K chat panel (Phase 3)
- `c935844` feat: complete Phase 2 - documents, ingestion CLI, memory browser
- Triage system with keyboard shortcuts
- Memory extraction and entity linking
- AI enrichment pipeline

### Documentation
- `dd7ea56` docs: add decision context to memory architecture discussion
- `0804892` docs: add Memory V2 implementation plan
- `9efcb48` docs: add memory architecture discussion and decision

### Infrastructure
- Magic link authentication
- Session middleware
- Drizzle ORM setup
- PostgreSQL on Railway

---

## Initial Setup

### Foundation
- Next.js 16 with App Router
- TypeScript configuration
- Tailwind CSS with Aurelius theme (dark/gold)
- Custom fonts (Inter, Playfair Display, JetBrains Mono)
- shadcn/ui components

### Database Schema
- `users` - User accounts
- `sessions` - Auth sessions
- `magic_links` - Single-use auth tokens
- `configs` - Versioned markdown configs
- `activity_log` - Audit trail
- `entities` - People, companies, projects
- `facts` - Memory facts linked to entities
- `documents` - Ingested content
- `inbox_items` - Triage items
- `suggested_tasks` - AI-extracted tasks

---

*Entries are added chronologically. See git log for full commit history.*
