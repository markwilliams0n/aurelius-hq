# Triage Learning Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken archive-count learning signal with engagement-based triage path tracking, natural language rules, inline rule proposals, and an activity feed.

**Architecture:** Track *how* emails are handled (bulk/quick/engaged) instead of just final status. Store rules as natural language in the existing `triage_rules` table (migrated to new schema). Inject active rules into the classifier prompt. Propose new rules inline via Sonner toasts when behavioral patterns emerge.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL (Neon), Sonner toasts, Tailwind CSS v4

**Design doc:** `docs/plans/2026-02-23-triage-learning-loop-design.md`

---

## Task 1: Migrate `triage_rules` Schema

Add new enum values and columns to support proposed/dismissed rules with natural language and pattern tracking.

**Files:**
- Create: `src/lib/db/migrations/learning-loop-schema.sql`
- Modify: `src/lib/db/schema/triage.ts:40-51` (enums) and `:187-233` (triageRules table)

**Step 1: Write the migration SQL**

Create `src/lib/db/migrations/learning-loop-schema.sql`:

```sql
-- Add new rule_status values for proposed/dismissed workflow
ALTER TYPE rule_status ADD VALUE IF NOT EXISTS 'proposed';
ALTER TYPE rule_status ADD VALUE IF NOT EXISTS 'dismissed';

-- Add new rule_source value for learned rules
ALTER TYPE rule_source ADD VALUE IF NOT EXISTS 'learned';

-- Add columns for pattern tracking and evidence
ALTER TABLE triage_rules ADD COLUMN IF NOT EXISTS pattern_key text;
ALTER TABLE triage_rules ADD COLUMN IF NOT EXISTS evidence jsonb;

-- Add index on pattern_key for dedup lookups
CREATE INDEX IF NOT EXISTS triage_rules_pattern_key_idx ON triage_rules (pattern_key) WHERE pattern_key IS NOT NULL;

-- Add triagePath to classification JSON — no schema change needed since it's JSONB,
-- but we note here that classification will now include:
--   triagePath: 'bulk' | 'quick' | 'engaged'
--   matchedRules: string[] (rule IDs that influenced this classification)
```

**Step 2: Run the migration**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq"
npx neon-serverless < src/lib/db/migrations/learning-loop-schema.sql
```

Actually, run via the Neon SQL tool or `psql` with the Neon connection string:

```bash
psql "$DATABASE_URL" -f src/lib/db/migrations/learning-loop-schema.sql
```

Expected: All ALTER statements succeed (or no-op with IF NOT EXISTS).

**Step 3: Update the Drizzle schema to match**

In `src/lib/db/schema/triage.ts`, update the enums and table:

```typescript
// Triage rule status — add 'proposed' and 'dismissed'
export const ruleStatusEnum = pgEnum("rule_status", [
  "active",
  "inactive",
  "proposed",
  "dismissed",
]);

// Rule source — add 'learned'
export const ruleSourceEnum = pgEnum("rule_source", [
  "user_chat",
  "user_settings",
  "daily_learning",
  "override",
  "learned",
]);
```

Add columns to `triageRules` table definition:

```typescript
// Pattern tracking (for proposed rules — prevents re-proposing dismissed patterns)
patternKey: text("pattern_key"),
evidence: jsonb("evidence").$type<{
  sender?: string;
  senderDomain?: string;
  bulkArchived?: number;
  quickArchived?: number;
  engaged?: number;
  total?: number;
  overrideCount?: number;
}>(),
```

**Step 4: Run `npx prisma generate` equivalent for Drizzle**

No codegen step needed for Drizzle — the schema IS the source of truth. Just verify TypeScript compiles:

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

Expected: No errors.

**Step 5: Commit**

```bash
git add src/lib/db/migrations/learning-loop-schema.sql src/lib/db/schema/triage.ts
git commit -m "feat(PER-249): migrate triage_rules schema for learning loop"
```

---

## Task 2: Add `triagePath` to Archive Actions

Send `triagePath` from the client for bulk archives and derive it server-side for individual archives.

**Files:**
- Modify: `src/hooks/use-triage-actions.ts:498-505` (bulkArchiveItems — add `triagePath: 'bulk'` to API call)
- Modify: `src/hooks/use-triage-actions.ts:146-149` (handleArchive — no change needed, server derives quick vs engaged)
- Modify: `src/app/api/triage/[id]/route.ts:10-33` (logDecision — accept and store triagePath)
- Modify: `src/app/api/triage/[id]/route.ts:100-113` (archive case — extract triagePath from body)

**Step 1: Update `bulkArchiveItems` to send `triagePath: 'bulk'`**

In `src/hooks/use-triage-actions.ts`, inside `bulkArchiveItems`, change the fetch body:

```typescript
// Before:
body: JSON.stringify({ action: 'archive' }),

// After:
body: JSON.stringify({ action: 'archive', triagePath: 'bulk' }),
```

**Step 2: Update the archive case in the API to extract triagePath**

In `src/app/api/triage/[id]/route.ts`, the `archive` case:

```typescript
case "archive":
  updates.status = "archived";
  updates.snoozedUntil = null;
  if (item.connector === "gmail") {
    backgroundTasks.push(
      syncArchiveToGmail(item.id).catch((error) => {
        console.error("[Triage] Background Gmail archive failed:", error);
      })
    );
  }
  logDecision(item, "archived", actionData.triagePath);
  break;
```

**Step 3: Update `logDecision` to derive and store triagePath**

```typescript
function logDecision(item: InboxItem, actualAction: string, clientTriagePath?: string) {
  if (item.connector !== "gmail") return;
  const classification = item.classification as Record<string, unknown> | null;
  if (!classification?.recommendation) return;

  const recommendedArchive = classification.recommendation === "archive";
  const userArchived = actualAction === "archived" || actualAction === "spam";
  const wasOverride = recommendedArchive !== userArchived;

  // Derive triagePath:
  // - 'bulk' comes from the client (batch archive button)
  // - 'engaged' if item had prior non-archive actions logged
  // - 'quick' otherwise (opened/selected, then archived)
  let triagePath: string = clientTriagePath || "quick";
  if (!clientTriagePath && actualAction === "archived") {
    // Check if there was a prior action on this item (flag, snooze, action-needed, etc.)
    const priorAction = classification.actualAction;
    if (priorAction && priorAction !== "archived") {
      triagePath = "engaged";
    }
  }
  // Non-archive actions are always 'engaged'
  if (actualAction !== "archived" && actualAction !== "spam") {
    triagePath = "engaged";
  }

  const enrichedClassification = {
    ...classification,
    actualAction,
    wasOverride,
    triagePath,
    decidedAt: new Date().toISOString(),
  } as any;

  db.update(inboxItems)
    .set({ classification: enrichedClassification })
    .where(eq(inboxItems.id, item.id))
    .catch((err) => console.error("[Triage] Decision log failed:", err));
}
```

**Step 4: Also log triagePath for other actions (snooze, flag, action-needed)**

Update all `logDecision` calls in the route to pass `undefined` for triagePath (they'll get `"engaged"` since they're not archive actions):

The existing calls like `logDecision(item, "snoozed")` already work — the function defaults non-archive actions to `"engaged"`.

**Step 5: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/hooks/use-triage-actions.ts src/app/api/triage/[id]/route.ts
git commit -m "feat(PER-249): add triagePath tracking to archive actions"
```

---

## Task 3: Rewrite Decision History with Triage Path Signals

Replace the broken archive-count decision history with bulk/quick/engaged breakdowns.

**Files:**
- Modify: `src/lib/triage/decision-history.ts` (full rewrite)

**Step 1: Rewrite the module**

Replace the entire contents of `src/lib/triage/decision-history.ts`:

```typescript
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface TriagePathCounts {
  bulk: number;
  quick: number;
  engaged: number;
  total: number;
}

export interface DecisionSummary {
  sender: string;
  senderDomain: string;
  senderDecisions: TriagePathCounts;
  domainDecisions: TriagePathCounts;
}

function emptyTriagePathCounts(): TriagePathCounts {
  return { bulk: 0, quick: 0, engaged: 0, total: 0 };
}

function rowsToCounts(
  rows: Array<{ triage_path: string; count: number }>
): TriagePathCounts {
  const counts = emptyTriagePathCounts();
  for (const row of rows) {
    if (row.triage_path === "bulk") counts.bulk = row.count;
    else if (row.triage_path === "quick") counts.quick = row.count;
    else if (row.triage_path === "engaged") counts.engaged = row.count;
  }
  counts.total = counts.bulk + counts.quick + counts.engaged;
  return counts;
}

/**
 * Query triage path history for a sender and their domain.
 * Extracts triagePath from the classification JSONB column.
 */
export async function getDecisionHistory(
  sender: string,
  senderDomain: string
): Promise<DecisionSummary> {
  const [senderRows, domainRows] = await Promise.all([
    // Exact sender — group by triagePath
    db.execute(sql`
      SELECT classification->>'triagePath' as triage_path, count(*)::int as count
      FROM inbox_items
      WHERE connector = 'gmail'
        AND sender = ${sender}
        AND status != 'new'
        AND classification->>'triagePath' IS NOT NULL
      GROUP BY classification->>'triagePath'
    `),
    // Domain — group by triagePath
    db.execute(sql`
      SELECT classification->>'triagePath' as triage_path, count(*)::int as count
      FROM inbox_items
      WHERE connector = 'gmail'
        AND sender LIKE '%@' || ${senderDomain}
        AND status != 'new'
        AND classification->>'triagePath' IS NOT NULL
      GROUP BY classification->>'triagePath'
    `),
  ]);

  return {
    sender,
    senderDomain,
    senderDecisions: rowsToCounts(senderRows.rows as any),
    domainDecisions: rowsToCounts(domainRows.rows as any),
  };
}

/**
 * Format decision history for the classifier prompt.
 * New format: "Sender x@y.com: bulk-archived 6/9, quick-archived 2/9, engaged 1/9"
 */
export function formatDecisionHistory(summary: DecisionSummary): string {
  const { sender, senderDomain, senderDecisions, domainDecisions } = summary;

  if (senderDecisions.total === 0 && domainDecisions.total === 0) {
    return `No prior history with ${sender} or domain ${senderDomain}.`;
  }

  const lines: string[] = [];

  if (senderDecisions.total > 0) {
    lines.push(`Sender ${sender}: ${formatTriageCounts(senderDecisions)}`);
  }

  if (domainDecisions.total > 0) {
    lines.push(`Domain ${senderDomain}: ${formatTriageCounts(domainDecisions)}`);
  }

  return lines.join("\n");
}

function formatTriageCounts(counts: TriagePathCounts): string {
  const parts: string[] = [];
  if (counts.bulk > 0) parts.push(`bulk-archived ${counts.bulk}/${counts.total}`);
  if (counts.quick > 0) parts.push(`quick-archived ${counts.quick}/${counts.total}`);
  if (counts.engaged > 0) parts.push(`engaged ${counts.engaged}/${counts.total}`);
  return parts.join(", ");
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/triage/decision-history.ts
git commit -m "feat(PER-249): rewrite decision history with triage path signals"
```

---

## Task 4: Switch Classifier to Read Rules from DB

Replace `email:preferences` config with active rules from `triage_rules` table.

**Files:**
- Modify: `src/lib/triage/classify-email.ts:67-116` (buildClassificationPrompt — replace preferences with rules)
- Modify: `src/lib/triage/classify-email.ts:219-228` (fetchPreferences → fetchActiveRules)
- Modify: `src/lib/triage/classify-email.ts:238-293` (classifyEmail — wire new context)
- Modify: `src/lib/triage/classify-emails-pipeline.ts:21` (remove seedEmailPreferences call)
- Modify: `src/lib/triage/classify-email.ts:33-57` (update system prompt guidelines)

**Step 1: Replace `fetchPreferences` with `fetchActiveRules`**

In `src/lib/triage/classify-email.ts`, replace the `fetchPreferences` function:

```typescript
import { getActiveRules } from "./rules";

/**
 * Fetch active triage rules from DB and format for the classifier prompt.
 * Returns an array of rule text strings.
 */
async function fetchActiveRuleTexts(): Promise<string[]> {
  try {
    const rules = await getActiveRules();
    return rules.map((r) => {
      if (r.type === "guidance" && r.guidance) return r.guidance;
      if (r.type === "structured" && r.trigger) {
        // Format structured rules as natural language for the LLM
        const parts: string[] = [];
        const t = r.trigger as Record<string, string>;
        if (t.sender) parts.push(`from ${t.sender}`);
        if (t.senderDomain) parts.push(`from @${t.senderDomain}`);
        if (t.subjectContains) parts.push(`with subject containing "${t.subjectContains}"`);
        return `${r.name}: Archive emails ${parts.join(" ")}`;
      }
      return r.name;
    });
  } catch {
    return [];
  }
}
```

**Step 2: Update `buildClassificationPrompt` to use rules instead of preferences**

In the context parameter type and the prompt builder, rename `preferences` to `rules`:

```typescript
export function buildClassificationPrompt(
  email: { ... },
  context: {
    decisionHistory: string;
    senderMemoryContext: string;
    rules: string[];
  }
): string {
  // ... (email metadata and decision history sections unchanged)

  // Rules (replaces preferences)
  if (context.rules.length > 0) {
    lines.push("");
    lines.push("=== TRIAGE RULES ===");
    for (const rule of context.rules) {
      lines.push(`- ${rule}`);
    }
  }

  return lines.join("\n");
}
```

**Step 3: Update `classifyEmail` to call `fetchActiveRuleTexts`**

```typescript
const [decisionSummary, senderMemoryContext, rules] =
  await Promise.all([
    getDecisionHistory(item.sender, senderDomain),
    fetchSenderMemoryContext(item.sender, item.senderName),
    fetchActiveRuleTexts(),
  ]);

// ... in buildClassificationPrompt call:
{ decisionHistory, senderMemoryContext, rules }
```

**Step 4: Remove `seedEmailPreferences` from the pipeline**

In `src/lib/triage/classify-emails-pipeline.ts`, remove the import and the call:

```typescript
// Remove: import { seedEmailPreferences } from './seed-preferences';
// Remove: await seedEmailPreferences();
```

**Step 5: Update the system prompt to reference rules instead of preferences**

In `CLASSIFICATION_SYSTEM_PROMPT`, update the guidelines section:

```
Guidelines:
- If the triage rules explicitly cover this sender/domain, follow the rule with 0.95+ confidence
- If user bulk-archives 100% from this sender, confidence for "archive" should be 0.95+
- New senders with no history → lean toward "attention" with lower confidence
- Direct personal emails from known contacts → almost always "attention"
- Automated notifications → lean toward "archive" unless user has engaged with them
- Weight triage rules heavily — they represent confirmed user preferences
```

**Step 6: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/lib/triage/classify-email.ts src/lib/triage/classify-emails-pipeline.ts
git commit -m "feat(PER-249): classifier reads rules from DB instead of config preferences"
```

---

## Task 5: Migrate Seed Preferences to Triage Rules

Convert the existing `INITIAL_PREFERENCES` into guidance rules and ensure the structured seed rules cover the same ground.

**Files:**
- Modify: `src/lib/triage/rules.ts:7-38` (verify SEED_RULES cover INITIAL_PREFERENCES)
- Modify: `src/lib/triage/seed-preferences.ts` (convert to seed guidance rules)

**Step 1: Add guidance rules for preferences not covered by structured rules**

The existing `SEED_RULES` in `rules.ts` already cover notifications, finance, calendar, and newsletters as structured rules. The two preferences not covered are:

- "Always surface direct personal emails from people I've met or work with"
- "If someone new reaches out directly, treat it as needing my attention"

Add these as guidance rules in the seed function. In `src/lib/triage/rules.ts`, add to `seedDefaultRules`:

```typescript
// Guidance rules (natural language for AI context)
const SEED_GUIDANCE: Array<{ name: string; guidance: string }> = [
  {
    name: "Surface personal emails from contacts",
    guidance: "Always surface direct personal emails from people the user has met or works with",
  },
  {
    name: "New direct outreach needs attention",
    guidance: "If someone new reaches out directly, treat it as needing attention",
  },
];

// Inside seedDefaultRules, after the structured rules loop:
for (const seed of SEED_GUIDANCE) {
  if (existingNames.has(seed.name)) continue;
  await db.insert(triageRules).values({
    name: seed.name,
    type: "guidance",
    source: "user_settings",
    guidance: seed.guidance,
    description: "Default guidance — auto-created",
  });
  created++;
}
```

**Step 2: Update `seed-preferences.ts` to be a no-op or remove**

Since `seedEmailPreferences` is no longer called from the pipeline (removed in Task 4), we can leave the file as-is — it's dead code. Or optionally delete it.

Leave it for now — it's harmless and may serve as reference.

**Step 3: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/lib/triage/rules.ts
git commit -m "feat(PER-249): add guidance rules to seed defaults for personal email preferences"
```

---

## Task 6: Build the Rule Proposal Engine

Server-side function that analyzes triage path patterns and generates proposed rules.

**Files:**
- Create: `src/lib/triage/rule-proposals.ts`

**Step 1: Create the proposal engine**

Create `src/lib/triage/rule-proposals.ts`:

```typescript
import { db } from "@/lib/db";
import { inboxItems, triageRules } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

interface SenderPattern {
  sender: string;
  senderName: string | null;
  bulk: number;
  quick: number;
  engaged: number;
  total: number;
}

interface ProposalResult {
  type: "archive" | "surface";
  sender: string;
  senderName: string | null;
  evidence: {
    bulk: number;
    quick: number;
    engaged: number;
    total: number;
    overrideCount?: number;
  };
  ruleText: string;
}

// Thresholds for proposing rules
const INITIAL_THRESHOLD = 3;
const THRESHOLDS = [3, 5, 8]; // ramp on dismissal
const MAX_DISMISSALS = 3;

/**
 * Check for behavioral patterns that warrant rule proposals.
 * Called after triage actions (archive, engage, override).
 *
 * Returns proposals for the given sender, or null if no proposal is warranted.
 */
export async function checkForProposals(
  sender: string,
  senderName: string | null
): Promise<ProposalResult | null> {
  // 1. Check if there's already an active or proposed rule for this sender
  const existingRule = await db
    .select()
    .from(triageRules)
    .where(
      and(
        sql`${triageRules.patternKey} = ${sender}`,
        sql`${triageRules.status} IN ('active', 'proposed')`
      )
    )
    .limit(1);

  if (existingRule.length > 0) return null;

  // 2. Count dismissals for this pattern
  const dismissedRules = await db
    .select()
    .from(triageRules)
    .where(
      and(
        sql`${triageRules.patternKey} = ${sender}`,
        eq(triageRules.status, "dismissed")
      )
    );

  const dismissalCount = dismissedRules.length;
  if (dismissalCount >= MAX_DISMISSALS) return null;

  // 3. Determine the current threshold based on dismissals
  const threshold = THRESHOLDS[Math.min(dismissalCount, THRESHOLDS.length - 1)];

  // 4. Query triage path counts for this sender
  const rows = await db.execute(sql`
    SELECT
      classification->>'triagePath' as triage_path,
      count(*)::int as count
    FROM inbox_items
    WHERE connector = 'gmail'
      AND sender = ${sender}
      AND status != 'new'
      AND classification->>'triagePath' IS NOT NULL
    GROUP BY classification->>'triagePath'
  `);

  const counts: SenderPattern = {
    sender,
    senderName,
    bulk: 0,
    quick: 0,
    engaged: 0,
    total: 0,
  };

  for (const row of rows.rows as Array<{ triage_path: string; count: number }>) {
    if (row.triage_path === "bulk") counts.bulk = row.count;
    else if (row.triage_path === "quick") counts.quick = row.count;
    else if (row.triage_path === "engaged") counts.engaged = row.count;
  }
  counts.total = counts.bulk + counts.quick + counts.engaged;

  if (counts.total < threshold) return null;

  // 5. Check for noise pattern: all bulk/quick, no engaged
  const noiseCount = counts.bulk + counts.quick;
  if (noiseCount === counts.total && counts.total >= threshold) {
    const displayName = senderName || sender;
    return {
      type: "archive",
      sender,
      senderName,
      evidence: { ...counts },
      ruleText: `Always archive emails from ${displayName}`,
    };
  }

  // 6. Check for override/engagement pattern
  // Query overrides: items where classifier said archive but user engaged
  const overrideRows = await db.execute(sql`
    SELECT count(*)::int as count
    FROM inbox_items
    WHERE connector = 'gmail'
      AND sender = ${sender}
      AND classification->>'wasOverride' = 'true'
      AND classification->>'triagePath' = 'engaged'
  `);

  const overrideCount = (overrideRows.rows as Array<{ count: number }>)[0]?.count ?? 0;

  if (overrideCount >= 2) {
    const displayName = senderName || sender;
    return {
      type: "surface",
      sender,
      senderName,
      evidence: { ...counts, overrideCount },
      ruleText: `Always surface emails from ${displayName}`,
    };
  }

  // 7. Check for high engagement pattern
  if (counts.engaged === counts.total && counts.total >= threshold) {
    const displayName = senderName || sender;
    return {
      type: "surface",
      sender,
      senderName,
      evidence: { ...counts },
      ruleText: `Always surface emails from ${displayName}`,
    };
  }

  return null;
}

/**
 * Create a proposed rule in the database.
 * Returns the created rule ID.
 */
export async function createProposedRule(proposal: ProposalResult): Promise<string> {
  const [rule] = await db
    .insert(triageRules)
    .values({
      name: proposal.ruleText,
      type: "guidance",
      source: "learned",
      status: "proposed",
      guidance: proposal.ruleText,
      patternKey: proposal.sender,
      evidence: proposal.evidence,
      description: `Auto-proposed based on ${proposal.evidence.total} triage actions`,
    })
    .returning();

  return rule.id;
}

/**
 * Accept a proposed rule — set status to active.
 */
export async function acceptProposal(ruleId: string): Promise<void> {
  await db
    .update(triageRules)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(triageRules.id, ruleId));
}

/**
 * Dismiss a proposed rule.
 */
export async function dismissProposal(ruleId: string): Promise<void> {
  await db
    .update(triageRules)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(triageRules.id, ruleId));
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/triage/rule-proposals.ts
git commit -m "feat(PER-249): build rule proposal engine with threshold ramping"
```

---

## Task 7: Wire Proposals into Triage Actions

After archive/engage actions, check for proposals and return them to the client.

**Files:**
- Modify: `src/app/api/triage/[id]/route.ts:78-265` (POST handler — add proposal check after action)
- Create: `src/app/api/triage/rules/[id]/accept/route.ts`
- Create: `src/app/api/triage/rules/[id]/dismiss/route.ts`

**Step 1: Add proposal check to the archive action response**

In `src/app/api/triage/[id]/route.ts`, after the DB update, check for proposals:

```typescript
import { checkForProposals, createProposedRule } from "@/lib/triage/rule-proposals";

// ... at the end of the POST handler, before the return:

// Check for rule proposals (only for gmail archive/engage actions)
let proposal = null;
if (item.connector === "gmail" && ["archive", "actioned", "action-needed"].includes(action)) {
  const proposalResult = await checkForProposals(item.sender, item.senderName).catch(() => null);
  if (proposalResult) {
    const ruleId = await createProposedRule(proposalResult).catch(() => null);
    if (ruleId) {
      proposal = {
        id: ruleId,
        type: proposalResult.type,
        ruleText: proposalResult.ruleText,
        sender: proposalResult.sender,
        senderName: proposalResult.senderName,
        evidence: proposalResult.evidence,
      };
    }
  }
}

return NextResponse.json({
  success: true,
  action,
  item: updatedItem,
  proposal,
});
```

**Step 2: Create accept endpoint**

Create `src/app/api/triage/rules/[id]/accept/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { acceptProposal } from "@/lib/triage/rule-proposals";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await acceptProposal(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Rules] Failed to accept proposal:", error);
    return NextResponse.json({ error: "Failed to accept" }, { status: 500 });
  }
}
```

**Step 3: Create dismiss endpoint**

Create `src/app/api/triage/rules/[id]/dismiss/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { dismissProposal } from "@/lib/triage/rule-proposals";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await dismissProposal(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Rules] Failed to dismiss proposal:", error);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
```

**Step 4: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/app/api/triage/[id]/route.ts src/app/api/triage/rules/[id]/accept/route.ts src/app/api/triage/rules/[id]/dismiss/route.ts
git commit -m "feat(PER-249): wire rule proposals into triage actions with accept/dismiss endpoints"
```

---

## Task 8: Inline Toast Proposals on the Client

Show Sonner toasts with accept/dismiss buttons when the API returns a proposal.

**Files:**
- Modify: `src/hooks/use-triage-actions.ts` (handle proposal in archive response)

**Step 1: Update `handleArchive` to show proposal toast**

In `src/hooks/use-triage-actions.ts`, update the archive fetch to check for proposals:

```typescript
const handleArchive = useCallback(() => {
  if (!currentItem) return;

  const itemToArchive = currentItem;
  const apiId = itemToArchive.dbId || itemToArchive.id;
  setAnimatingOut('left');
  updateLastAction({ type: 'archive', itemId: itemToArchive.id, item: itemToArchive });

  fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
  fetch(`/api/triage/${apiId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'archive' }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.proposal) {
        showProposalToast(data.proposal);
      }
    })
    .catch((error) => {
      console.error('Failed to archive:', error);
      toast.error('Failed to archive - item restored');
      setLocalItems((prev) => [itemToArchive, ...prev]);
    });

  setTimeout(() => {
    setLocalItems((prev) => prev.filter((i) => i.id !== itemToArchive.id));
    setAnimatingOut(null);
  }, 150);

  toast.success('Archived', {
    action: { label: 'Undo', onClick: () => handleUndo() },
  });
}, [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo]);
```

**Step 2: Add `showProposalToast` function**

Add this function inside the `useTriageActions` hook:

```typescript
const showProposalToast = useCallback((proposal: {
  id: string;
  type: string;
  ruleText: string;
  sender: string;
  senderName: string | null;
  evidence: { bulk?: number; quick?: number; engaged?: number; total?: number; overrideCount?: number };
}) => {
  const displayName = proposal.senderName || proposal.sender;
  const ev = proposal.evidence;

  let message: string;
  if (proposal.type === "archive") {
    message = `You've archived ${ev.total}/${ev.total} from ${displayName} — always archive?`;
  } else {
    if (ev.overrideCount) {
      message = `You overrode archive for ${displayName} ${ev.overrideCount} times — always surface?`;
    } else {
      message = `You engaged with ${ev.engaged}/${ev.total} from ${displayName} — always surface?`;
    }
  }

  toast(message, {
    duration: 10000,
    action: {
      label: "Yes",
      onClick: () => {
        fetch(`/api/triage/rules/${proposal.id}/accept`, { method: "POST" })
          .then(() => {
            toast.success("Rule created");
            mutateRules();
          })
          .catch(() => toast.error("Failed to create rule"));
      },
    },
    cancel: {
      label: "Not yet",
      onClick: () => {
        fetch(`/api/triage/rules/${proposal.id}/dismiss`, { method: "POST" }).catch(() => {});
      },
    },
  });
}, [mutateRules]);
```

**Step 3: Also show proposals after bulk archive**

Update `bulkArchiveItems` to check proposals from the last item's response. Since bulk archive fires many parallel requests, only check the last response:

```typescript
// In bulkArchiveItems, for the last item in the batch:
const lastItem = itemsToArchive[itemsToArchive.length - 1];
const lastApiId = lastItem.dbId || lastItem.id;
fetch(`/api/triage/${lastApiId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'archive', triagePath: 'bulk' }),
})
  .then((res) => res.json())
  .then((data) => {
    if (data.proposal) showProposalToast(data.proposal);
  })
  .catch(console.error);
```

Actually, simpler: each individual archive call in the loop can return proposals. Just check the responses from the parallel calls:

```typescript
itemsToArchive.forEach((item) => {
  const apiId = item.dbId || item.id;
  fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
  fetch(`/api/triage/${apiId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'archive', triagePath: 'bulk' }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.proposal) showProposalToast(data.proposal);
    })
    .catch(console.error);
});
```

**Step 4: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/hooks/use-triage-actions.ts
git commit -m "feat(PER-249): show inline rule proposal toasts after triage actions"
```

---

## Task 9: Build Activity Feed Component

The default email tab view showing a timeline of classifier decisions.

**Files:**
- Create: `src/components/aurelius/triage-activity-feed.tsx`
- Create: `src/app/api/triage/activity/route.ts`

**Step 1: Create the activity feed API**

Create `src/app/api/triage/activity/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";

// GET /api/triage/activity — recent classification activity
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    // Fetch recently classified gmail items (both new and already triaged)
    const items = await db
      .select({
        id: inboxItems.id,
        sender: inboxItems.sender,
        senderName: inboxItems.senderName,
        subject: inboxItems.subject,
        status: inboxItems.status,
        classification: inboxItems.classification,
        createdAt: inboxItems.createdAt,
        updatedAt: inboxItems.updatedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.connector, "gmail"),
          isNotNull(inboxItems.classification)
        )
      )
      .orderBy(desc(inboxItems.createdAt))
      .limit(limit);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[Activity] Failed to fetch:", error);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
```

**Step 2: Create the activity feed component**

Create `src/components/aurelius/triage-activity-feed.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Archive,
  Eye,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Settings2,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ClassificationData {
  recommendation?: string;
  confidence?: number;
  reasoning?: string;
  actualAction?: string;
  wasOverride?: boolean;
  triagePath?: string;
  classifiedAt?: string;
  matchedRules?: string[];
}

interface ActivityItem {
  id: string;
  sender: string;
  senderName: string | null;
  subject: string;
  status: string;
  classification: ClassificationData | null;
  createdAt: string;
  updatedAt: string;
}

interface ActivityBatch {
  date: string;
  label: string;
  items: ActivityItem[];
  stats: {
    total: number;
    archived: number;
    review: number;
    attention: number;
    overrides: number;
  };
}

function groupIntoBatches(items: ActivityItem[]): ActivityBatch[] {
  const groups = new Map<string, ActivityItem[]>();

  for (const item of items) {
    const date = new Date(item.createdAt);
    // Group by date + hour window
    const key = `${date.toLocaleDateString()} ${date.getHours() < 12 ? "AM" : "PM"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return Array.from(groups.entries()).map(([label, items]) => {
    const stats = {
      total: items.length,
      archived: items.filter((i) => i.classification?.recommendation === "archive").length,
      review: items.filter((i) => i.classification?.recommendation === "review").length,
      attention: items.filter((i) => i.classification?.recommendation === "attention").length,
      overrides: items.filter((i) => i.classification?.wasOverride).length,
    };
    return { date: items[0].createdAt, label, items, stats };
  });
}

function getRecommendationIcon(rec?: string) {
  switch (rec) {
    case "archive":
      return <Archive className="w-3.5 h-3.5 text-green-400" />;
    case "review":
      return <Eye className="w-3.5 h-3.5 text-gold" />;
    case "attention":
      return <AlertCircle className="w-3.5 h-3.5 text-orange-400" />;
    default:
      return null;
  }
}

interface ActivityFeedProps {
  onOpenRulesPanel: () => void;
  onCreateRule: (input: string) => void;
}

export function TriageActivityFeed({ onOpenRulesPanel, onCreateRule }: ActivityFeedProps) {
  const { data } = useSWR("/api/triage/activity?limit=100", fetcher, {
    refreshInterval: 30000,
  });
  const [ruleInput, setRuleInput] = useState("");
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const batches = useMemo(() => {
    if (!data?.items) return [];
    return groupIntoBatches(data.items);
  }, [data?.items]);

  const toggleBatch = (label: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleSubmitRule = () => {
    if (!ruleInput.trim()) return;
    onCreateRule(ruleInput.trim());
    setRuleInput("");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Activity Feed</h2>
        </div>
        <button
          onClick={onOpenRulesPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Manage Rules
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {batches.map((batch) => {
          const isExpanded = expandedBatches.has(batch.label) || batches.length <= 2;
          return (
            <div key={batch.label}>
              {/* Batch header */}
              <button
                onClick={() => toggleBatch(batch.label)}
                className="w-full flex items-center justify-between mb-2 group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {batch.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {batch.stats.total} classified
                    {batch.stats.overrides > 0 && `, ${batch.stats.overrides} overrides`}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                )}
              </button>

              {/* Batch items */}
              {isExpanded && (
                <div className="space-y-1">
                  {batch.items.map((item) => (
                    <ActivityEntry key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {batches.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            No classification activity yet.
          </div>
        )}
      </div>

      {/* Rule input */}
      <div className="border-t border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ruleInput}
            onChange={(e) => setRuleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmitRule();
              }
            }}
            placeholder="Type a rule... e.g. &quot;always archive from zapier&quot;"
            className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleSubmitRule}
            disabled={!ruleInput.trim()}
            className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const c = item.classification;
  const isOverride = c?.wasOverride;
  const displayName = item.senderName || item.sender;

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-lg text-sm",
        isOverride && "bg-orange-500/5 border border-orange-500/10"
      )}
    >
      <div className="pt-0.5">{getRecommendationIcon(c?.recommendation)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground truncate">{displayName}</span>
          <span className="text-xs text-muted-foreground truncate">{item.subject}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {isOverride && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400">
              <AlertTriangle className="w-3 h-3" />
              Override — suggested {c?.recommendation}, you {c?.actualAction}
            </span>
          )}
          {!isOverride && c?.reasoning && (
            <span className="text-[10px] text-muted-foreground/70 line-clamp-1">
              {c.reasoning}
            </span>
          )}
          {c?.confidence != null && (
            <span className="text-[10px] text-muted-foreground/50">
              {Math.round(c.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/components/aurelius/triage-activity-feed.tsx src/app/api/triage/activity/route.ts
git commit -m "feat(PER-249): build activity feed component and API"
```

---

## Task 10: Build Rules Panel (Slide-out)

A slide-out panel for managing all rules: pending proposals, active rules, dismissed.

**Files:**
- Create: `src/components/aurelius/triage-rules-panel.tsx`

**Step 1: Create the rules panel component**

Create `src/components/aurelius/triage-rules-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  X,
  Check,
  XCircle,
  RotateCcw,
  Sparkles,
  User,
  ChevronDown,
  ChevronUp,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { TriageRule } from "@/lib/db/schema";

interface RulesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  rules: TriageRule[];
  onMutateRules: () => void;
}

export function TriageRulesPanel({ isOpen, onClose, rules, onMutateRules }: RulesPanelProps) {
  const [showDismissed, setShowDismissed] = useState(false);

  if (!isOpen) return null;

  const proposedRules = rules.filter((r) => r.status === "proposed");
  const activeRules = rules.filter((r) => r.status === "active");
  const dismissedRules = rules.filter((r) => r.status === "dismissed");

  const handleAccept = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}/accept`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Rule activated");
      onMutateRules();
    } catch {
      toast.error("Failed to accept rule");
    }
  };

  const handleDismiss = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Rule dismissed");
      onMutateRules();
    } catch {
      toast.error("Failed to dismiss rule");
    }
  };

  const handleToggle = async (rule: TriageRule) => {
    const newStatus = rule.status === "active" ? "inactive" : "active";
    try {
      const res = await fetch(`/api/triage/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      onMutateRules();
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Rule deleted");
      onMutateRules();
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const handleUndismiss = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/triage/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "proposed" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Rule restored to proposals");
      onMutateRules();
    } catch {
      toast.error("Failed to restore rule");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-background border-l border-border z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Triage Rules</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary/50 text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
          {/* Pending Proposals */}
          {proposedRules.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gold mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Pending Proposals ({proposedRules.length})
              </h3>
              <div className="space-y-2">
                {proposedRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="border border-gold/20 bg-gold/5 rounded-lg p-3"
                  >
                    <p className="text-sm font-medium">{rule.guidance || rule.name}</p>
                    {rule.evidence && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Based on: {formatEvidence(rule.evidence as Record<string, number>)}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => handleAccept(rule.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Approve
                      </button>
                      <button
                        onClick={() => handleDismiss(rule.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-secondary text-muted-foreground rounded hover:bg-secondary/80 transition-colors"
                      >
                        <XCircle className="w-3 h-3" /> Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Active Rules */}
          <section>
            <h3 className="text-sm font-medium text-foreground mb-3">
              Active Rules ({activeRules.length})
            </h3>
            <div className="space-y-1.5">
              {activeRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border/50 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">
                        {rule.guidance || rule.name}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full",
                          rule.source === "learned"
                            ? "bg-purple-500/20 text-purple-400"
                            : "bg-secondary text-muted-foreground"
                        )}
                      >
                        {rule.source === "learned" ? "learned" : "you"}
                      </span>
                    </div>
                    {rule.matchCount > 0 && (
                      <span className="text-[10px] text-muted-foreground/60">
                        Matched {rule.matchCount} times
                        {rule.lastMatchedAt && ` · last ${new Date(rule.lastMatchedAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleToggle(rule)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground"
                      title="Disable"
                    >
                      <ToggleRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {activeRules.length === 0 && (
                <p className="text-xs text-muted-foreground/60 py-2">
                  No active rules yet. Type one in the activity feed or wait for suggestions.
                </p>
              )}
            </div>
          </section>

          {/* Dismissed (collapsed) */}
          {dismissedRules.length > 0 && (
            <section>
              <button
                onClick={() => setShowDismissed(!showDismissed)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDismissed ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                Dismissed ({dismissedRules.length})
              </button>
              {showDismissed && (
                <div className="mt-2 space-y-1.5">
                  {dismissedRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/20 text-muted-foreground"
                    >
                      <span className="flex-1 text-sm truncate line-through opacity-60">
                        {rule.guidance || rule.name}
                      </span>
                      <button
                        onClick={() => handleUndismiss(rule.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-secondary transition-colors"
                        title="Restore"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function formatEvidence(evidence: Record<string, number>): string {
  const parts: string[] = [];
  if (evidence.bulkArchived) parts.push(`bulk-archived ${evidence.bulkArchived}`);
  else if (evidence.bulk) parts.push(`bulk-archived ${evidence.bulk}`);
  if (evidence.quickArchived) parts.push(`quick-archived ${evidence.quickArchived}`);
  else if (evidence.quick) parts.push(`quick-archived ${evidence.quick}`);
  if (evidence.engaged) parts.push(`engaged ${evidence.engaged}`);
  if (evidence.total) parts.push(`of ${evidence.total} total`);
  if (evidence.overrideCount) parts.push(`${evidence.overrideCount} overrides`);
  return parts.join(", ");
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/components/aurelius/triage-rules-panel.tsx
git commit -m "feat(PER-249): build rules management slide-out panel"
```

---

## Task 11: Wire Activity Feed and Rules Panel into Triage Client

Replace the email tiers as the default email view with the activity feed, and add the rules panel slide-out.

**Files:**
- Modify: `src/app/triage/triage-client.tsx` (add activity feed as default email tab, wire rules panel)
- Modify: `src/hooks/use-triage-navigation.ts` (add email sub-view state if needed)

**Step 1: Add state and imports to triage-client**

In `src/app/triage/triage-client.tsx`, add imports:

```typescript
import { TriageActivityFeed } from "@/components/aurelius/triage-activity-feed";
import { TriageRulesPanel } from "@/components/aurelius/triage-rules-panel";
```

Add state for the email sub-view and rules panel:

```typescript
const [emailSubView, setEmailSubView] = useState<"activity" | "triage">("activity");
const [isRulesPanelOpen, setIsRulesPanelOpen] = useState(false);
```

**Step 2: Add sub-view toggle to the email tab header**

In the email tab's section of the triage client, add toggle buttons between "Activity" (the feed) and "Triage" (the existing tier view). The activity feed is the default.

When the user has unclassified items, show the triage view. Otherwise show activity.

```tsx
{/* Email sub-view toggle (only when on gmail connector filter) */}
{connectorFilter === "gmail" && (
  <div className="flex items-center gap-1 bg-secondary/30 rounded-lg p-0.5">
    <button
      onClick={() => setEmailSubView("activity")}
      className={cn(
        "px-3 py-1 text-xs rounded-md transition-colors",
        emailSubView === "activity"
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      Activity
    </button>
    <button
      onClick={() => setEmailSubView("triage")}
      className={cn(
        "px-3 py-1 text-xs rounded-md transition-colors",
        emailSubView === "triage"
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      Triage ({filteredItems.length})
    </button>
  </div>
)}
```

**Step 3: Render the appropriate view**

Replace the email tiers rendering with a conditional:

```tsx
{connectorFilter === "gmail" && emailSubView === "activity" && (
  <TriageActivityFeed
    onOpenRulesPanel={() => setIsRulesPanelOpen(true)}
    onCreateRule={actions.handleRuleInput}
  />
)}

{connectorFilter === "gmail" && emailSubView === "triage" && (
  <TriageEmailTiers
    items={filteredItems}
    tasksByItemId={tasksByItemId}
    onBulkArchive={actions.handleBulkArchiveItems}
    onSelectItem={(item) => { /* existing select logic */ }}
    activeItemId={currentItem?.id}
  />
)}
```

**Step 4: Add the rules panel**

At the top level of the return, add:

```tsx
<TriageRulesPanel
  isOpen={isRulesPanelOpen}
  onClose={() => setIsRulesPanelOpen(false)}
  rules={triageRules || []}
  onMutateRules={mutateRules}
/>
```

**Step 5: Auto-switch to triage when items exist**

When new items arrive and the user is on the activity view, show a subtle indicator or auto-switch:

```typescript
// When items arrive, if we're on activity and there are triage items, show badge
// Let the user manually switch — don't auto-switch
```

For now, just show the count in the "Triage" tab button. The user clicks it manually.

**Step 6: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/app/triage/triage-client.tsx
git commit -m "feat(PER-249): wire activity feed and rules panel into triage client"
```

---

## Task 12: Add `Shift+ArrowLeft` Keyboard Shortcut for Quick Archive

Quick archive from any view (triagePath: `quick`).

**Files:**
- Modify: `src/app/triage/triage-client.tsx` (add keyboard binding)
- Modify: `src/hooks/use-triage-actions.ts` (add handleQuickArchive)

**Step 1: Add `handleQuickArchive` to use-triage-actions**

```typescript
// Quick archive (Shift+ArrowLeft) — archives with triagePath 'quick'
const handleQuickArchive = useCallback(() => {
  if (!currentItem) return;

  const itemToArchive = currentItem;
  const apiId = itemToArchive.dbId || itemToArchive.id;
  setAnimatingOut('left');
  updateLastAction({ type: 'archive', itemId: itemToArchive.id, item: itemToArchive });

  fetch(`/api/triage/${apiId}/tasks`, { method: 'DELETE' }).catch(() => {});
  fetch(`/api/triage/${apiId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'archive', triagePath: 'quick' }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.proposal) showProposalToast(data.proposal);
    })
    .catch((error) => {
      console.error('Failed to archive:', error);
      toast.error('Failed to archive - item restored');
      setLocalItems((prev) => [itemToArchive, ...prev]);
    });

  setTimeout(() => {
    setLocalItems((prev) => prev.filter((i) => i.id !== itemToArchive.id));
    setAnimatingOut(null);
  }, 150);

  toast.success('Archived', {
    action: { label: 'Undo', onClick: () => handleUndo() },
  });
}, [currentItem, setAnimatingOut, updateLastAction, setLocalItems, handleUndo, showProposalToast]);
```

Export it from the hook's return object.

**Step 2: Add keyboard binding in triage-client**

In the `keyBindings` array:

```typescript
{
  key: "ArrowLeft",
  modifiers: { shift: true },
  handler: actions.handleQuickArchive,
  when: () => isIndividualCard,
},
```

**Step 3: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/hooks/use-triage-actions.ts src/app/triage/triage-client.tsx
git commit -m "feat(PER-249): add Shift+ArrowLeft keyboard shortcut for quick archive"
```

---

## Task 13: Hit Tracking for Rules

When the classifier runs, track which rules it matched and update hit counts.

**Files:**
- Modify: `src/lib/triage/classify-email.ts` (add matchedRules to classification output)
- Modify: `src/lib/triage/classify-emails-pipeline.ts` (update hit counts after classification)

**Step 1: Add `matchedRule` to the classification prompt**

Update the system prompt in `classify-email.ts` to ask the LLM to include which rule(s) it followed:

```typescript
// Add to the JSON response schema in CLASSIFICATION_SYSTEM_PROMPT:
//   "matchedRules": ["rule text that influenced this decision"]

// And update the EmailClassification interface:
export interface EmailClassification {
  recommendation: "archive" | "review" | "attention";
  confidence: number;
  reasoning: string;
  signals: {
    senderHistory: string;
    relationshipContext: string;
    contentAnalysis: string;
  };
  matchedRules?: string[];  // Rule texts that influenced this classification
}
```

**Step 2: Parse matchedRules from the LLM response**

In `parseClassificationResponse`, extract:

```typescript
const matchedRules = Array.isArray(parsed.matchedRules) ? parsed.matchedRules : [];
return { recommendation, confidence, reasoning, signals, matchedRules };
```

**Step 3: Update hit counts in the pipeline**

In `classify-emails-pipeline.ts`, after saving classifications, update hit counts:

```typescript
import { getActiveRules, incrementRuleMatchCount } from "./rules";

// After the classification loop, update hit counts for matched rules
const activeRules = await getActiveRules();
for (const item of items) {
  const classification = classifications.get(item.id);
  if (!classification?.matchedRules?.length) continue;

  for (const ruleText of classification.matchedRules) {
    // Find matching rule by name or guidance text
    const matchedRule = activeRules.find(
      (r) => r.guidance === ruleText || r.name === ruleText
    );
    if (matchedRule) {
      await incrementRuleMatchCount(matchedRule.id);
    }
  }
}
```

**Step 4: Verify TypeScript compiles**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/lib/triage/classify-email.ts src/lib/triage/classify-emails-pipeline.ts
git commit -m "feat(PER-249): add rule hit tracking to classification pipeline"
```

---

## Task 14: Final Integration Test and Cleanup

Verify the full flow works end-to-end.

**Step 1: Run TypeScript check**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit
```

**Step 2: Start the dev server and test manually**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run dev
```

Test in the browser:
1. Go to `/triage` → email tab should show Activity Feed by default
2. Click "Triage" sub-tab → should show email tiers
3. Bulk archive from tier view → items should get `triagePath: 'bulk'`
4. Use `Shift+ArrowLeft` to quick-archive → should get `triagePath: 'quick'`
5. Engage with an item (flag, snooze) then archive → should get `triagePath: 'engaged'`
6. After 3+ consistent archives from one sender → proposal toast should appear
7. Click "Yes" on proposal → rule should appear in rules panel
8. Click "Manage Rules" → rules panel should slide open
9. Type a rule in the activity feed input → rule should be created
10. Trigger heartbeat → classifier should use rules from DB

**Step 3: Clean up dead code**

Remove or flag `seed-preferences.ts` as deprecated. The `email:preferences` config key is no longer used by the classifier.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(PER-249): complete triage learning loop implementation"
```
