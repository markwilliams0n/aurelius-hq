# Triage Learning Loop Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken "did you archive this?" signal with a meaningful engagement-based learning loop that proposes and manages triage rules.

**Architecture:** Track the *triage path* (how an email was handled, not just the final status) to distinguish noise from important emails. Use this signal to propose rules inline during triage, with a rules panel for management and an activity feed for transparency.

---

## 1. The Engagement Signal

### Problem

In a triage system, everything eventually gets archived. Tracking "did you archive from this sender" converges to 100% for every sender, making the classifier's decision history useless.

### Solution: Triage Path

Instead of raw archive counts, track **how** the email was handled:

- **`bulk`** — archived from the tier batch button without opening the email. Strongest noise signal.
- **`quick`** — selected/opened the email, then archived without any other action. Mild noise signal.
- **`engaged`** — took at least one action before archiving: flagged, snoozed, chatted, used tools, created a task. The email mattered.

### How each path is determined

- **`bulk`**: The client sends `{ action: 'archive', triagePath: 'bulk' }` from `handleBulkArchiveItems()`. Only the client knows this was a batch action.
- **`quick` vs `engaged`**: Derived server-side. When an archive action arrives, the API checks the item's `classification` column for any prior `actualAction` that isn't `archived`. If one exists (flag, snooze, action-needed, etc.), it's `engaged`. Otherwise, `quick`.

### Decision history format (replaces current)

Current (broken):
```
Sender notifications@github.com: archived 8/9, acted on 1
```

New:
```
Sender notifications@github.com: bulk-archived 6/9, quick-archived 2/9, engaged 1/9
```

This tells the classifier: "80% noise, but occasionally important."

---

## 2. The Rules Model

### Two rule types

**Explicit rules** — user types them in natural language:
- "Always archive from PushEngage"
- "I don't care about calendar updates"
- "Surface anything from Katie directly"

**Proposed rules** — system generates from behavior patterns:
- "You've bulk-archived 5/5 from beehiiv — always archive?"
- "You engaged with 3/3 from Vivian Donohue — always surface?"

### Storage: `triage_rules` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `rule` | text | Natural language rule text |
| `status` | enum | `active`, `proposed`, `dismissed` |
| `source` | enum | `user`, `learned` |
| `hit_count` | int | Times this rule influenced a classification |
| `last_hit_at` | timestamp | When the rule last fired |
| `pattern_key` | text | For proposed rules: the sender/domain pattern (prevents re-proposing dismissed rules) |
| `evidence` | jsonb | For proposed rules: the data that triggered the proposal (e.g., `{ sender: "x@beehiiv.com", bulkArchived: 5, total: 5 }`) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### How rules reach the classifier

All active rules are injected into the classifier's prompt context, replacing the current `email:preferences` config. The LLM interprets them — no regex or structured matching needed. This keeps rule creation frictionless while supporting complex preferences like "Surface anything from people at AEG unless it's a calendar update."

The current seed preferences become initial rules seeded on first run (source: `user`, status: `active`).

### Hit tracking

When the classifier runs, it includes the matched rule text in its `signals.matchedRule` field. The pipeline updates `hit_count` and `last_hit_at` for matched rules after each classification batch.

---

## 3. Inline Rule Proposals

### Archive pattern (noise detection)

When the system detects consistent bulk/quick archives from a sender, it proposes an archive rule **inline during triage** via a toast:

> *"You've archived 3/3 from PushEngage — always archive?"*
> **[Yes]** **[Not yet]**

- **Yes**: Creates the rule immediately (status: `active`, source: `learned`)
- **Not yet**: Dismisses the toast but doesn't block future proposals

### Override pattern (false positive detection)

When the user engages with something the classifier suggested archiving:

> *"You overrode archive for David Klein twice — always surface?"*
> **[Yes]** **[Not yet]**

### Threshold ramping

- First proposal at **3** consecutive consistent actions
- If dismissed, wait until **5**, then **8**
- After **3 dismissals** for the same pattern, stop asking (mark `dismissed` in DB)

### Where proposals appear

Toast notification after the triggering archive/engage action, while the user is still in triage context. Not in a separate tab — the moment of decision is the best time to codify a rule.

---

## 4. Activity Feed (Default Email Tab View)

A timeline showing what the classifier did and why. Grouped by sync batch.

### Batch header

> **Today 8:32 PM** — 11 emails classified, 7 auto-matched rules, 4 need review

### Entry format

Standard classification:
> **PushEngage** — `rostr.cc weekly stats`
> Archived (rule: "Always archive from PushEngage") · 98% confidence

Override:
> **David Klein** — `Accepted: ROSTR x 237 Global`
> ⚠️ Suggested archive → you engaged

No matching rule:
> **New sender** — `Partnership opportunity`
> Needs attention · no matching rules · 72% confidence

### Data source

Queries the `classification` JSON column on `inbox_items` (already has recommendation, confidence, reasoning, actualAction, triagePath). Group by `created_at` batch windows. No new table needed for the feed.

### Chat input

The activity feed has a chat-style input at the bottom for typing rules directly: "always archive from zapier." This creates a rule (source: `user`, status: `active`) and optionally re-classifies matching emails in the current inbox.

---

## 5. Rules Panel (Slide-out)

Opens from a "Manage Rules" button in the activity feed header.

### Three sections

**Pending proposals** (top):
- Rules the system wants confirmed
- Shows evidence: "Based on: bulk-archived 5/5 since Feb 19"
- Actions: Approve / Edit / Dismiss

**Active rules**:
- All confirmed rules (user-created and approved proposals)
- Each shows: rule text, hit count, last hit date, source badge ("you" / "learned")
- Toggle to disable without deleting

**Dismissed** (collapsed):
- Rejected proposals, so you can un-dismiss if you change your mind

---

## 6. Keyboard Shortcuts

In the email tier view:
- `Shift+←` — archive current email (triagePath: `quick`)

---

## 7. Migration Path

1. Create `triage_rules` table
2. Migrate existing `email:preferences` config entries into `triage_rules` as active user rules
3. Update `classify-email.ts` to read from `triage_rules` instead of `email:preferences`
4. Update `decision-history.ts` to query by `triagePath` instead of raw status
5. Add `triagePath` to `logDecision()` and the archive API endpoint
6. Build rule proposal engine (runs on heartbeat or after triage actions)
7. Build activity feed component
8. Build rules panel component
9. Wire inline toast proposals into triage actions

---

## Key Principles

- **Rules are natural language** — the LLM interprets them, no structured matching
- **Propose at the moment of decision** — inline toasts, not a separate workflow
- **Engagement is the signal** — bulk/quick/engaged, not archived/not-archived
- **Progressive thresholds** — don't nag, ramp up confidence before proposing
- **Everything is reversible** — dismiss, disable, un-dismiss, edit
