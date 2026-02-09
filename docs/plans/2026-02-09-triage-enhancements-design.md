# Triage Enhancements: Smart Pre-processing & Batch Actions

**Date:** 2026-02-09
**Branch:** feature/triage-enhancements

## Problem

Every triage session requires processing every item individually. Many items (routine notifications, bot messages, newsletters) are instantly archived — wasted attention. The system should learn what you care about and pre-group obvious actions, letting you blow through 30+ items in seconds.

## Design Overview

Three interconnected systems:

1. **Classification pipeline** — Tiered AI processing on each heartbeat (rules → Ollama → Kimi)
2. **Batch cards** — Persistent grouped action cards at the top of triage
3. **Rule learning loop** — AI-driven rule evolution from your triage behavior

---

## 1. Classification Pipeline

Each heartbeat syncs new items from connectors. New items (not yet classified) go through a three-pass pipeline:

### Pass 1 — Rule Matching (no AI, instant)

Check structured rules first. Deterministic pattern matching: sender, connector type, subject patterns. If a rule matches, the item is classified and slotted into a batch card immediately.

### Pass 2 — Ollama (local, cheap)

Items without a rule match go to Ollama with the current AI guidance notes as context. Ollama returns a classification: which batch card to slot the item into, or "surface individually." Handles ~80% of items that are pattern-recognizable.

Ollama also returns a confidence score. Items below a configurable threshold proceed to Pass 3.

### Pass 3 — Kimi (cloud, smart)

Ambiguous items get analyzed by Kimi. Since Kimi is already looking at the item, it returns **both** the classification and full enrichment (summary, suggested priority, suggested tags, etc.) — no separate enrichment pass needed.

Every Kimi call is logged with: token counts, cost estimate, item ID, classification result, and timestamp. Surfaced in the settings page and as a badge on the item.

### Classification Storage

Each item gets a `classification` JSONB field:

```json
{
  "batchCardId": "batch-abc123",
  "tier": "ollama",
  "confidence": 0.92,
  "reason": "Routine Linear notification from Aurelius bot",
  "classifiedAt": "2026-02-09T10:00:00Z"
}
```

Items are only classified once. The classification persists across heartbeats.

---

## 2. Batch Cards

Batch cards are triage cards with a distinct visual treatment that appear at the top of the triage view. They accumulate items over multiple heartbeats until actioned.

### Visual Treatment

- Same triage card format, but with a different background tint and left border accent
- Immediately distinguishable from individual items
- Header: batch title + item count ("Archive these — 10 items")
- Explanation line: one sentence from the AI explaining why these are grouped ("Routine Linear status updates from Aurelius. None require action.")
- Item list visible immediately (no expand needed)
- Each item: checkbox + sender + subject + one-line AI summary
- All items checked by default
- Footer: action button + chat input for rule refinement
- AI tier badge on each item (subtle "Ollama" or "Kimi" indicator)

### Default Batch Card Types

- **Archive these** — Items needing no attention (newsletters, routine notifications, bot messages)
- **Note & archive** — Worth knowing about but not acting on (FYI emails, status changes). One-line summaries shown.
- **Spam** — Suspected spam/marketing
- **Needs attention** — Important items reviewable as a group (e.g., multiple emails from same thread)

The AI can also create **dynamic batch cards** based on patterns — e.g., "GitHub: aurelius-hq (6 items)" instead of stuffing them into generic "archive these."

### Keyboard Interaction

When a batch card is active:

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Move through items in the list |
| `Space` | Toggle checkbox on focused item |
| `Shift+Space` | Select range |
| `a` | Check all |
| `n` | Uncheck all |
| `←` | Execute batch action on checked items |

### Actioning a Batch Card

When you execute the batch action:
- All checked items get the action applied (archive, etc.)
- Unchecked items get their `classification` cleared and drop into individual triage below
- The batch card disappears

### Persistence

Batch cards use the existing `action_cards` table. Items link to their batch card via the `classification.batchCardId` field. New items from subsequent heartbeats get appended to existing batch cards.

### Ordering

Batch cards appear first in triage, sorted by confidence (highest first — spam is usually very confident). Individual items follow after all batch cards.

---

## 3. Rule System

### Rule Types

**Structured rules** — Fast, deterministic patterns evaluated in Pass 1 (no AI):

```json
{
  "id": "rule-abc",
  "type": "sender_match",
  "pattern": "aurelius-bot",
  "connector": "linear",
  "action": "batch:archive",
  "reason": "Auto-created from user override",
  "createdAt": "2026-02-09",
  "source": "daily_learning"
}
```

**AI guidance notes** — Nuanced natural language instructions included in Ollama/Kimi classification prompts:

```
"Mark cares about project updates from the mobile team even when they look routine"
"GitHub PR reviews from external contributors should always surface individually"
```

### Rule Priority

Structured rules always win over AI judgment. AI guidance notes influence but don't override structured rules.

### Creating Rules

**From batch card chat:** Type "stop auto-archiving from Sarah" in the chat input on the batch card. The AI parses this into a structured rule (if it's a simple pattern) or a guidance note (if nuanced), confirms what it created, and applies immediately to future items.

**From overrides (proactive suggestions):** When the system detects repeated overrides (e.g., you keep unchecking emails from the same sender), it suggests a rule: "You've kept 4 emails from Sarah out of auto-archive. Want me to always surface her emails individually?"

**Manual in settings:** A rules config page listing all rules and guidance notes, editable via natural language.

### All Rules Editable via Natural Language

Whether a rule is stored as structured data or a guidance note, the user interface is always natural language. You type what you want; the system decides the storage format. The settings page shows rules in human-readable form with an edit box.

---

## 4. Daily Learning Loop

A daily reflection job (runs on heartbeat after a configurable time, e.g., midnight or first morning heartbeat).

### Input

Kimi receives:
- All triage actions from the last 24 hours (from `activity_log`)
- Which batch card suggestions were accepted vs overridden
- Items the user spent time on (opened chat, read detail) vs quickly archived
- Current rule set and guidance notes

### Output

- **New rule suggestions** — "You archived all 8 Vercel deployment notifications. Suggest: auto-archive Vercel deploy success emails."
- **Rule refinements** — "Your rule catches all Linear notifications, but you keep pulling out urgent bug reports. Suggest: add exception for urgent priority."
- **Confidence adjustments** — "Ollama has been uncertain on newsletter-style emails from acme.io — adding structured rule."

### Surfacing Suggestions

A special batch card at the top of the next triage session: "Aurelius learned 3 new patterns yesterday" — list of suggested rule changes, each with accept/reject/edit.

Rejected suggestions are noted so they aren't suggested again.

---

## 5. Cost Monitoring

### Settings Page

"Triage AI" section showing:
- Daily/weekly token usage and cost estimates
- Items processed per tier (rules / Ollama / Kimi)
- Kimi call log: item ID, tokens, cost, classification result, timestamp

### Inline Badges

Subtle tier badge on each item in batch cards and individual triage cards: "Rules", "Ollama", or "Kimi" — useful for debugging during development and understanding cost distribution.

---

## Data Model Changes

### inbox_items additions

```sql
ALTER TABLE inbox_items ADD COLUMN classification JSONB;
-- { batchCardId, tier, confidence, reason, classifiedAt }
```

### New: triage_rules table

```sql
CREATE TABLE triage_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'structured' | 'guidance'
  rule JSONB NOT NULL, -- structured: {type, pattern, connector, action} / guidance: {text}
  reason TEXT, -- why this rule exists
  source TEXT NOT NULL, -- 'user_chat' | 'user_settings' | 'daily_learning' | 'override_suggestion'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

### New: ai_cost_log table

```sql
CREATE TABLE ai_cost_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, -- 'ollama' | 'kimi'
  operation TEXT NOT NULL, -- 'classify' | 'enrich' | 'daily_learning' | 'rule_parse'
  item_id UUID REFERENCES inbox_items(id),
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost NUMERIC(10, 6),
  result JSONB, -- classification result, rule created, etc.
  created_at TIMESTAMP DEFAULT now()
);
```

---

## Implementation Sequence

1. DB migrations (classification field, triage_rules, ai_cost_log tables)
2. Rule storage & CRUD API
3. Classification pipeline (Pass 1 rule matching → Pass 2 Ollama → Pass 3 Kimi)
4. Batch card creation & persistence (reuse action_cards)
5. Batch card UI (triage card variant with list, checkboxes, keyboard nav)
6. Batch card chat input → rule creation
7. Cost logging & settings page section
8. Daily learning loop
9. Override detection & proactive rule suggestions
