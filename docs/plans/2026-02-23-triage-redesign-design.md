# Triage Redesign: Email Assistant + Granola Task Queue

> **Status**: Design approved, ready for implementation planning
> **Date**: 2026-02-23

## Problem

The current triage system tries to be a unified inbox for 4 connectors (Gmail, Granola, Linear, Slack) with a generic classification pipeline. This doesn't work well because:

- Email and meetings have fundamentally different workflows — you don't "triage" a meeting the same way you triage an email
- The classification system (rules → Ollama → Kimi) is rule-heavy and doesn't learn meaningfully from user behavior
- Batch cards group by pattern type (newsletters, notifications) rather than by what the user actually wants to do
- Linear and Slack items add noise without providing enough value in triage

## Solution

Split triage into **two purpose-built workflows** that share the same page but have entirely different UX and intelligence:

1. **Email Triage** — AI assistant that learns what to archive, focused on clearing inbox noise
2. **Granola Triage** — Task extraction queue for meeting action items

Remove Linear and Slack from the heartbeat sync. Code stays in codebase, dormant.

---

## Email Triage: AI-First Classification

### Core Architecture

The LLM is the classifier. No more rule-based pattern matching as the primary system.

```
New email synced from Gmail
    ↓
Build classification context:
    ├─ Email content + metadata (sender, domain, subject, recipients)
    ├─ Supermemory query: "What do I know about this sender?"
    │   → relationship context, meeting history, entity info
    ├─ Inbox history: past decisions for this sender/domain
    │   → "archived 8/8", "replied to 3/5", "never seen before"
    └─ Natural language preferences (user-defined guidance)
    ↓
LLM classifies → { action, confidence, reasoning }
    ↓
Present in confidence tiers
```

### Classification Output

For each email, the LLM returns:

```typescript
interface EmailClassification {
  recommendation: 'archive' | 'review' | 'attention';
  confidence: number; // 0-1
  reasoning: string;  // human-readable explanation
  signals: {
    senderHistory: string;    // "archived 8/8 from this sender"
    relationshipContext: string; // "met with them last Tuesday"
    contentAnalysis: string;  // "automated notification, no action needed"
  };
}
```

### Confidence Tiers (UI)

**Tier 1: "Ready to archive"** (confidence >= 0.90)
- Presented as a single batch card with item count
- Expandable checklist showing each email + one-line reasoning
- One-click "Archive All" button
- User can uncheck individual items to keep them
- Example reasoning: "You always archive Calendly notifications (12/12)"

**Tier 2: "Quick review"** (confidence 0.60-0.89)
- Individual cards with visible AI reasoning
- Faster triage — reasoning helps you decide quickly
- Example: "GitHub PR review — you usually engage, but this repo you don't contribute to"

**Tier 3: "Needs your attention"** (confidence < 0.60)
- Traditional per-item triage with full action set
- New senders, direct emails, things the AI can't pattern-match
- Example: "First email from someone you met last Tuesday"

### Natural Language Preferences

Replace structured triage_rules with natural language guidance stored in config:

```
Key: email:preferences
Value: [
  "Always surface emails from people I've met with in the last month",
  "Archive anything that looks like an automated notification unless it's from Linear or GitHub",
  "If someone I've never emailed before reaches out directly, that's high priority",
  "I don't care about marketing emails from SaaS tools I don't actively use"
]
```

These are injected into the LLM classification prompt. The LLM interprets them flexibly — it understands that "people I've met with" means cross-referencing Supermemory for recent meetings.

Users can add/edit preferences through chat: "Hey, start archiving all Substack newsletters" → updates the preference list.

### Learning Loop

Every triage action feeds the classification system:

**Decision logging** — New `email_decisions` table (or column on inbox_items):

```typescript
interface EmailDecision {
  itemId: string;
  recommendation: 'archive' | 'review' | 'attention';
  recommendedConfidence: number;
  actualAction: 'archived' | 'replied' | 'snoozed' | 'tasked' | 'flagged';
  wasOverride: boolean; // user disagreed with recommendation
  senderDomain: string;
  sender: string;
  decidedAt: Date;
}
```

**Implicit learning** — When classifying a new email, the LLM sees:
- "Last 10 decisions for emails from this sender: archived 8, replied 2"
- "Last 10 decisions for this domain: archived 10/10"
- "Override rate for similar recommendations: 2% (system is accurate for this pattern)"

**Override detection** — When the user acts differently than recommended:
- System logs the override
- Future classifications for similar emails get lower confidence
- After 3+ overrides for a pattern, the LLM reasoning includes: "Note: you've overridden archive suggestions for this sender 3 times"

### Email Actions (unchanged)

All existing email actions stay:
- Archive (←), Snooze (s), Reply (↓), Quick task (t)
- Spam (x), Action needed (a), Flag (f)
- Memory save (↑), Chat (Space), Expand (Enter)
- Undo (⌘Z/U)

---

## Granola Triage: Task Extraction Queue

### Core Architecture

```
Granola heartbeat sync
    ↓
Meeting saved to memory:
    ├─ Local DB: entities + facts (existing)
    └─ Supermemory: formatted summary + key facts (NEW)
    ↓
Task extraction (existing AI analysis)
    ↓
Filter to YOUR tasks (assignee = self or committed to)
    ↓
Tasks appear in Granola tab, grouped by meeting
```

### Memory Save (Enhanced)

Currently: AI extracts entities + facts → saves to local entities/facts tables.

New: ALSO send a formatted summary to Supermemory:

```
Meeting: Product Sync (Feb 23, 2026)
Attendees: Katie Chen, James Liu, Sarah Park
Summary: Discussed API integration timeline, agreed on Q2 launch...
Key decisions:
- API v2 launches in Q2
- Katie owns the migration plan
Action items:
- [Mark] Review API spec by Friday
- [Katie] Draft migration timeline
Topics: API integration, Q2 planning, migration
```

This enables semantic search: "what did we discuss about API timeline?" and gives the email classifier relationship context.

### Granola UI

Each meeting appears as a card showing:
- **Meeting name** + date + attendees
- **Your tasks** extracted from the discussion
- Each task: description, due date (if mentioned), confidence

**Per-task actions:**
- **Accept** (✓) → Creates Linear issue (pre-filled)
- **Dismiss** (✗) → Not your task / not actionable
- **Edit** → Tweak description before accepting

**Per-meeting actions:**
- **Done** → All tasks handled, archive the meeting card
- **Chat** (Space) → Open AI chat with full meeting context

No archive/snooze/priority/classification for meetings. Purely task-focused.

---

## What Changes

### Heartbeat
- Remove Linear sync call
- Remove Slack sync call
- Keep Gmail sync + Granola sync

### Classification Pipeline
- Remove 3-tier pipeline (rules → Ollama → Kimi)
- Replace with LLM classifier using RAG context (Supermemory + inbox history)
- Natural language preferences replace structured triage rules

### Database
- New: `email_decisions` tracking (table or columns on inbox_items)
- New: `email:preferences` config key for natural language rules
- Existing triage_rules table becomes dormant (keep data, stop using)

### Granola Memory
- Add Supermemory save (formatted summary) alongside existing entity/fact extraction

### UI
- Tab bar: only Email and Meetings tabs (remove Linear, Slack, All)
- Email tab: confidence tier layout (batch confirm → quick review → attention)
- Granola tab: meeting cards with task extraction focus
- Remove batch card system (replaced by confidence tier grouping)

### Dormant (code stays, not active)
- `src/lib/linear/sync.ts` — Linear triage sync
- `src/lib/slack/sync.ts` — Slack triage sync
- `src/lib/triage/classify-new-items.ts` — 3-tier classification
- `src/lib/triage/batch-cards.ts` — Batch card assignment
- Triage rules table + seed rules

## What Stays The Same

- `inbox_items` table schema
- `suggested_tasks` table
- Gmail sync connector (`src/lib/gmail/sync.ts`)
- Granola sync connector (enhanced, not replaced)
- All email triage actions
- Card view UX and keyboard shortcuts
- Chat overlay for triage items
- Snooze system
- Gmail sync-to-source (archive, spam, action-needed)

---

## Decisions

1. **Classification model**: OpenRouter (cloud) — use existing AI provider for best quality. Same models already used for chat/enrichment.

2. **Cold start**: Seed from existing 38 triage rules — convert them to natural language preferences to bootstrap the classifier. Phase out individual rules as real decision history builds up.

3. **Preference management**: Both chat and settings page. Chat for quick adds ("start archiving Substack newsletters"), settings page for viewing and editing the full list.

4. **Classification batching**: Smart batching — high-confidence patterns (newsletters, notifications from known-archive senders) classified in batches of 5-10. Uncertain emails get individual analysis with full context.
