# Triage Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unified 4-connector triage with two purpose-built workflows: an AI-first email assistant that learns what to archive, and a Granola task extraction queue.

**Architecture:** LLM classifier replaces the 3-tier rule/Ollama/Kimi pipeline. Classification uses RAG context (Supermemory for sender relationships + inbox history for past decisions). Granola auto-saves meetings to Supermemory and presents extracted tasks per-meeting. Linear and Slack removed from heartbeat.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL (Neon), OpenRouter AI, Supermemory, SWR, TypeScript.

**Design Doc:** `docs/plans/2026-02-23-triage-redesign-design.md`

**Linear Issue:** PER-248

---

## Phase 1: Backend Cleanup — Remove Linear/Slack from Triage

### Task 1: Remove Linear and Slack from connector registry

**Files:**
- Modify: `src/lib/connectors/index.ts`
- Modify: `src/lib/connectors/types.ts`
- Modify: `src/lib/memory/heartbeat.ts`

**Step 1: Remove Linear and Slack from the connector array**

In `src/lib/connectors/index.ts`, remove the Linear and Slack connectors from the registry:

```typescript
// BEFORE (lines 8-19)
import { gmailConnector } from './gmail';
import { granolaConnector } from './granola';
import { linearConnector } from './linear';
import { slackConnector } from './slack';
import type { Connector } from './types';

export const connectors: Connector[] = [
  granolaConnector,
  gmailConnector,
  linearConnector,
  slackConnector,
];

// AFTER
import { gmailConnector } from './gmail';
import { granolaConnector } from './granola';
import type { Connector } from './types';

export const connectors: Connector[] = [
  granolaConnector,
  gmailConnector,
];
```

**Step 2: Remove Linear/Slack from HeartbeatStep type**

In `src/lib/connectors/types.ts`, line 11:

```typescript
// BEFORE
export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'linear' | 'slack' | 'classify' | 'learning';

// AFTER
export type HeartbeatStep = 'backup' | 'granola' | 'gmail' | 'classify' | 'learning';
```

**Step 3: Clean up heartbeat types**

In `src/lib/memory/heartbeat.ts`:

- Remove imports for `LinearSyncResult` and `SlackSyncResult` (lines 16-17)
- Remove `skipLinear` and `skipSlack` from `HeartbeatOptions` (lines 41-43)
- Remove `linear` and `slack` from `HeartbeatResult` interface (lines 62-63)
- Remove `linear` and `slack` from `steps` type (lines 71-72)
- Remove `if (options.skipLinear)` and `if (options.skipSlack)` from skip logic (lines 119-120)
- Remove `linear` and `slack` from the return object (lines 183-184)

**Step 4: Run `tsc --noEmit` to verify no type errors**

Run: `npx tsc --noEmit`
Expected: Clean build (or only pre-existing warnings)

Fix any remaining references to linear/slack heartbeat steps that surface.

**Step 5: Run existing tests**

Run: `npx vitest run`
Expected: All passing (or pre-existing failures only)

**Step 6: Commit**

```bash
git add src/lib/connectors/index.ts src/lib/connectors/types.ts src/lib/memory/heartbeat.ts
# Also add any other files fixed in step 4
git commit -m "refactor(PER-248): remove Linear and Slack from heartbeat sync"
```

---

## Phase 2: Email Classification Backend

### Task 2: Add `email:preferences` config key

**Files:**
- Modify: `src/lib/db/schema/config.ts`

**Step 1: Add the new config key to the enum**

In `src/lib/db/schema/config.ts`, line 11, add `"email:preferences"` to the `configKeyEnum` array:

```typescript
export const configKeyEnum = pgEnum("config_key", [
  "soul", "system_prompt", "agents", "processes",
  "capability:tasks", "capability:config", "prompt:email_draft",
  "capability:slack", "slack:directory", "capability:vault",
  "capability:code", "capability:gmail", "capability:browser",
  "sync:gmail", "sync:granola", "sync:linear", "sync:slack",
  "capability:code-agent",
  "email:preferences"   // <-- NEW
]);
```

**Step 2: Run the DB migration**

Run the ALTER TYPE SQL against the database:

```bash
npx drizzle-kit generate
# Then apply:
npx drizzle-kit push
```

Or manually run:
```sql
ALTER TYPE config_key ADD VALUE 'email:preferences';
```

**Step 3: Seed initial preferences from existing rules**

Create a new file `src/lib/triage/seed-preferences.ts` that converts the 22 existing seed rules into natural language preferences:

```typescript
import { getLatestConfig, upsertConfig } from '@/lib/config';

const INITIAL_PREFERENCES = [
  "Archive notifications from GitHub, Figma, Slack, Airtable, Linear, Vercel, Railway, Neon, Sentry, Google Alerts, and Google Search Console",
  "Archive finance-related automated emails from Venmo, PayPal, Stripe, and QuickBooks",
  "Archive calendar invitations, updates, and cancellations",
  "Archive newsletters from Substack and Beehiiv",
  "Always surface direct personal emails from people I've met or work with",
  "If someone new reaches out directly, treat it as needing my attention",
];

export async function seedEmailPreferences(): Promise<boolean> {
  const existing = await getLatestConfig('email:preferences');
  if (existing) return false; // Already seeded

  await upsertConfig('email:preferences', JSON.stringify(INITIAL_PREFERENCES), 'system');
  return true;
}
```

**Step 4: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/lib/db/schema/config.ts src/lib/triage/seed-preferences.ts
git commit -m "feat(PER-248): add email:preferences config key and seed preferences"
```

---

### Task 3: Build sender decision history query

This function queries past triage decisions for a sender/domain to give the classifier behavioral context.

**Files:**
- Create: `src/lib/triage/decision-history.ts`

**Step 1: Write tests for decision history**

Create: `src/lib/triage/__tests__/decision-history.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { formatDecisionHistory, type DecisionSummary } from '../decision-history';

describe('formatDecisionHistory', () => {
  it('formats sender history with counts', () => {
    const summary: DecisionSummary = {
      sender: 'notifications@github.com',
      senderDomain: 'github.com',
      senderDecisions: { archived: 8, snoozed: 0, actioned: 1, total: 9 },
      domainDecisions: { archived: 12, snoozed: 1, actioned: 2, total: 15 },
    };
    const result = formatDecisionHistory(summary);
    expect(result).toContain('archived 8/9');
    expect(result).toContain('github.com');
  });

  it('handles new sender with no history', () => {
    const summary: DecisionSummary = {
      sender: 'new@unknown.com',
      senderDomain: 'unknown.com',
      senderDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
      domainDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
    };
    const result = formatDecisionHistory(summary);
    expect(result).toContain('No prior history');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/triage/__tests__/decision-history.test.ts`
Expected: FAIL — module not found

**Step 3: Implement decision history module**

Create `src/lib/triage/decision-history.ts`:

```typescript
/**
 * Decision History
 *
 * Queries past triage decisions by sender/domain to build
 * behavioral context for the email classifier.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface DecisionCounts {
  archived: number;
  snoozed: number;
  actioned: number;
  total: number;
}

export interface DecisionSummary {
  sender: string;
  senderDomain: string;
  senderDecisions: DecisionCounts;
  domainDecisions: DecisionCounts;
}

/**
 * Get decision history for a sender and their domain.
 * Only looks at gmail items that have left 'new' status.
 */
export async function getDecisionHistory(
  sender: string,
  senderDomain: string
): Promise<DecisionSummary> {
  // Query decisions by exact sender
  const senderRows = await db
    .select({
      status: inboxItems.status,
      count: sql<number>`count(*)::int`,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'gmail'),
        eq(inboxItems.sender, sender),
        sql`${inboxItems.status} != 'new'`
      )
    )
    .groupBy(inboxItems.status);

  // Query decisions by domain (broader pattern)
  const domainRows = await db
    .select({
      status: inboxItems.status,
      count: sql<number>`count(*)::int`,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'gmail'),
        sql`${inboxItems.sender} LIKE '%@' || ${senderDomain}`,
        sql`${inboxItems.status} != 'new'`
      )
    )
    .groupBy(inboxItems.status);

  return {
    sender,
    senderDomain,
    senderDecisions: rowsToCounts(senderRows),
    domainDecisions: rowsToCounts(domainRows),
  };
}

function rowsToCounts(
  rows: Array<{ status: string; count: number }>
): DecisionCounts {
  const counts: DecisionCounts = { archived: 0, snoozed: 0, actioned: 0, total: 0 };
  for (const row of rows) {
    if (row.status === 'archived') counts.archived = row.count;
    else if (row.status === 'snoozed') counts.snoozed = row.count;
    else if (row.status === 'actioned') counts.actioned = row.count;
    counts.total += row.count;
  }
  return counts;
}

/**
 * Format decision history into a human-readable string for the LLM.
 */
export function formatDecisionHistory(summary: DecisionSummary): string {
  const { senderDecisions, domainDecisions, sender, senderDomain } = summary;

  if (senderDecisions.total === 0 && domainDecisions.total === 0) {
    return `No prior history with ${sender} or domain ${senderDomain}.`;
  }

  const parts: string[] = [];

  if (senderDecisions.total > 0) {
    parts.push(
      `Sender ${sender}: archived ${senderDecisions.archived}/${senderDecisions.total}` +
      (senderDecisions.actioned > 0 ? `, acted on ${senderDecisions.actioned}` : '') +
      (senderDecisions.snoozed > 0 ? `, snoozed ${senderDecisions.snoozed}` : '')
    );
  }

  if (domainDecisions.total > senderDecisions.total) {
    parts.push(
      `Domain ${senderDomain}: archived ${domainDecisions.archived}/${domainDecisions.total}` +
      (domainDecisions.actioned > 0 ? `, acted on ${domainDecisions.actioned}` : '') +
      (domainDecisions.snoozed > 0 ? `, snoozed ${domainDecisions.snoozed}` : '')
    );
  }

  return parts.join('\n');
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/triage/__tests__/decision-history.test.ts`
Expected: PASS (for the formatting tests; the DB query tests would need mocking)

**Step 5: Commit**

```bash
git add src/lib/triage/decision-history.ts src/lib/triage/__tests__/decision-history.test.ts
git commit -m "feat(PER-248): add sender decision history for email classifier"
```

---

### Task 4: Build the AI email classifier

The core classifier function. Takes an email, gathers RAG context, calls LLM, returns recommendation with reasoning.

**Files:**
- Create: `src/lib/triage/classify-email.ts`

**Step 1: Write the classifier test**

Create: `src/lib/triage/__tests__/classify-email.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildClassificationPrompt, parseClassificationResponse } from '../classify-email';

describe('parseClassificationResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      recommendation: 'archive',
      confidence: 0.95,
      reasoning: 'Newsletter from Substack, user archives these',
      signals: {
        senderHistory: 'archived 8/8',
        relationshipContext: 'no relationship',
        contentAnalysis: 'newsletter content',
      },
    });
    const result = parseClassificationResponse(response);
    expect(result.recommendation).toBe('archive');
    expect(result.confidence).toBe(0.95);
    expect(result.reasoning).toContain('Newsletter');
  });

  it('returns low-confidence attention for unparseable response', () => {
    const result = parseClassificationResponse('garbage');
    expect(result.recommendation).toBe('attention');
    expect(result.confidence).toBe(0);
  });
});

describe('buildClassificationPrompt', () => {
  it('includes email content and context', () => {
    const prompt = buildClassificationPrompt(
      {
        sender: 'test@example.com',
        senderDomain: 'example.com',
        subject: 'Test email',
        content: 'Hello world',
        preview: 'Hello world',
        senderTags: ['Direct'],
      },
      {
        decisionHistory: 'No prior history',
        senderContext: 'Unknown sender',
        preferences: ['Archive newsletters'],
      }
    );
    expect(prompt).toContain('test@example.com');
    expect(prompt).toContain('Archive newsletters');
    expect(prompt).toContain('No prior history');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/triage/__tests__/classify-email.test.ts`
Expected: FAIL

**Step 3: Implement the email classifier**

Create `src/lib/triage/classify-email.ts`:

```typescript
/**
 * AI Email Classifier
 *
 * Uses LLM with RAG context (Supermemory + inbox history)
 * to classify emails into archive/review/attention tiers.
 */

import { chat } from '@/lib/ai/client';
import { getDecisionHistory, formatDecisionHistory } from './decision-history';
import { getMemoryContext } from '@/lib/memory/supermemory';
import { getLatestConfig } from '@/lib/config';
import type { InboxItem } from '@/lib/db/schema';

export interface EmailClassification {
  recommendation: 'archive' | 'review' | 'attention';
  confidence: number;
  reasoning: string;
  signals: {
    senderHistory: string;
    relationshipContext: string;
    contentAnalysis: string;
  };
}

interface EmailInput {
  sender: string;
  senderDomain: string;
  subject: string;
  content: string;
  preview: string;
  senderTags?: string[];
}

interface ClassificationContext {
  decisionHistory: string;
  senderContext: string;
  preferences: string[];
}

const SYSTEM_PROMPT = `You are an email triage assistant. Your job is to classify emails into one of three categories based on the user's history and preferences.

Categories:
- "archive": Email is noise, automated, or something the user consistently ignores. Safe to archive.
- "review": Email might be important but the user should glance at it quickly. Medium confidence.
- "attention": Email likely needs the user's direct engagement. New sender, personal message, or something they typically act on.

You must respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "recommendation": "archive" | "review" | "attention",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explanation for the user",
  "signals": {
    "senderHistory": "Brief note about past interactions with this sender",
    "relationshipContext": "What we know about the sender from memory",
    "contentAnalysis": "What kind of email this is"
  }
}

Important guidelines:
- If the user has archived 100% of emails from a sender, confidence for "archive" should be very high (0.95+)
- If this is a new sender with no history, lean toward "attention" with lower confidence
- Direct personal emails from known contacts should almost always be "attention"
- Automated notifications from services should lean toward "archive" unless the user has acted on them before
- Weight the user's preferences heavily — they explicitly told you what they care about`;

/**
 * Build the classification prompt with all RAG context.
 */
export function buildClassificationPrompt(
  email: EmailInput,
  context: ClassificationContext
): string {
  const parts = [
    '## Email to classify',
    `From: ${email.sender}`,
    `Subject: ${email.subject}`,
    email.senderTags?.length ? `Sender tags: ${email.senderTags.join(', ')}` : '',
    `Preview: ${email.preview}`,
    '',
    '## Decision history',
    context.decisionHistory,
    '',
    '## Sender context from memory',
    context.senderContext || 'No memory context available.',
    '',
    '## User preferences',
    ...context.preferences.map((p, i) => `${i + 1}. ${p}`),
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Parse the LLM's classification response.
 */
export function parseClassificationResponse(response: string): EmailClassification {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and clamp
    const recommendation = ['archive', 'review', 'attention'].includes(parsed.recommendation)
      ? parsed.recommendation
      : 'attention';
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;

    return {
      recommendation,
      confidence,
      reasoning: parsed.reasoning || 'Classification completed',
      signals: {
        senderHistory: parsed.signals?.senderHistory || '',
        relationshipContext: parsed.signals?.relationshipContext || '',
        contentAnalysis: parsed.signals?.contentAnalysis || '',
      },
    };
  } catch {
    return {
      recommendation: 'attention',
      confidence: 0,
      reasoning: 'Could not classify — showing for manual review',
      signals: { senderHistory: '', relationshipContext: '', contentAnalysis: '' },
    };
  }
}

/**
 * Load user preferences from config.
 */
async function loadPreferences(): Promise<string[]> {
  try {
    const config = await getLatestConfig('email:preferences');
    if (!config) return [];
    return JSON.parse(config.content);
  } catch {
    return [];
  }
}

/**
 * Get sender context from Supermemory.
 */
async function getSenderContext(sender: string, senderName: string): Promise<string> {
  try {
    const context = await getMemoryContext(`${senderName} ${sender}`);
    if (!context?.profile) return '';

    // Format profile facts relevant to this sender
    const facts = context.profile
      .filter((f: { text?: string }) => f.text)
      .map((f: { text: string }) => f.text)
      .slice(0, 5);

    return facts.length > 0 ? facts.join('\n') : '';
  } catch {
    return '';
  }
}

/**
 * Classify a single email using AI with RAG context.
 */
export async function classifyEmail(item: InboxItem): Promise<EmailClassification> {
  const senderDomain = item.sender?.includes('@')
    ? item.sender.split('@')[1]
    : '';

  // Gather RAG context in parallel
  const [decisionSummary, senderContext, preferences] = await Promise.all([
    getDecisionHistory(item.sender || '', senderDomain),
    getSenderContext(item.sender || '', item.senderName || ''),
    loadPreferences(),
  ]);

  const enrichment = item.enrichment as Record<string, unknown> | null;
  const senderTags = (enrichment?.senderTags as string[]) || [];

  const prompt = buildClassificationPrompt(
    {
      sender: item.sender || '',
      senderDomain,
      subject: item.subject || '',
      content: (item.content || '').slice(0, 3000),
      preview: item.preview || '',
      senderTags,
    },
    {
      decisionHistory: formatDecisionHistory(decisionSummary),
      senderContext,
      preferences,
    }
  );

  const response = await chat(prompt, SYSTEM_PROMPT, { timeoutMs: 15000 });
  return parseClassificationResponse(response);
}

/**
 * Classify multiple emails with smart batching.
 * High-history senders get batch-classified, new senders get individual analysis.
 */
export async function classifyEmails(
  items: InboxItem[]
): Promise<Map<string, EmailClassification>> {
  const results = new Map<string, EmailClassification>();
  const BATCH_SIZE = 5;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        const classification = await classifyEmail(item);
        return { id: item.id, classification };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.id, result.value.classification);
      }
    }
  }

  return results;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/triage/__tests__/classify-email.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/triage/classify-email.ts src/lib/triage/__tests__/classify-email.test.ts
git commit -m "feat(PER-248): AI email classifier with RAG context"
```

---

### Task 5: Replace classification pipeline in heartbeat

Swap the old 3-tier pipeline for the new AI classifier. Store classification result in the existing `classification` JSON column on `inbox_items`.

**Files:**
- Modify: `src/lib/memory/heartbeat.ts`
- Create: `src/lib/triage/classify-emails-pipeline.ts`

**Step 1: Create the new classification pipeline**

This replaces `classifyNewItems()` from `src/lib/triage/classify.ts`.

Create `src/lib/triage/classify-emails-pipeline.ts`:

```typescript
/**
 * Email Classification Pipeline
 *
 * Replaces the old 3-tier (rules -> Ollama -> Kimi) pipeline
 * with an AI-first classifier that uses decision history and
 * Supermemory context.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { classifyEmails, type EmailClassification } from './classify-email';
import { seedEmailPreferences } from './seed-preferences';

export interface ClassifyEmailsResult {
  classified: number;
  byTier: { archive: number; review: number; attention: number };
}

/**
 * Classify all unclassified gmail items.
 * Called by heartbeat after connector sync.
 */
export async function classifyNewEmails(): Promise<ClassifyEmailsResult> {
  // Seed preferences on first run
  await seedEmailPreferences();

  // Fetch unclassified gmail items
  const items = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, 'new'),
        eq(inboxItems.connector, 'gmail'),
        isNull(inboxItems.classification)
      )
    );

  if (items.length === 0) {
    return { classified: 0, byTier: { archive: 0, review: 0, attention: 0 } };
  }

  console.log(`[Classify] ${items.length} unclassified emails to process`);

  const classifications = await classifyEmails(items);
  const byTier = { archive: 0, review: 0, attention: 0 };

  // Save classifications to DB
  for (const item of items) {
    const classification = classifications.get(item.id);
    if (!classification) continue;

    byTier[classification.recommendation]++;

    const existingEnrichment = (item.enrichment as Record<string, unknown>) || {};

    await db
      .update(inboxItems)
      .set({
        classification: {
          recommendation: classification.recommendation,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
          signals: classification.signals,
          classifiedAt: new Date().toISOString(),
        },
        enrichment: {
          ...existingEnrichment,
          aiClassification: classification,
        },
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, item.id));
  }

  console.log(
    `[Classify] Done: ${items.length} emails ` +
    `(archive:${byTier.archive} review:${byTier.review} attention:${byTier.attention})`
  );

  return { classified: items.length, byTier };
}
```

**Step 2: Update heartbeat to use new classifier**

In `src/lib/memory/heartbeat.ts`, replace the classification section (lines 138-169):

```typescript
// BEFORE
import { classifyNewItems } from '@/lib/triage/classify';
import { seedDefaultRules } from '@/lib/triage/rules';

// ... in runHeartbeat():
if (!options.skipClassify) {
  await seedDefaultRules();
  const classifyResult = await classifyNewItems();
  // ...
}

// AFTER
import { classifyNewEmails } from '@/lib/triage/classify-emails-pipeline';

// ... in runHeartbeat():
if (!options.skipClassify) {
  progress?.('classify', 'start');
  const classifyStart = Date.now();
  try {
    const classifyResult = await classifyNewEmails();
    if (classifyResult.classified > 0) {
      console.log(
        `[Heartbeat] Classify: ${classifyResult.classified} emails ` +
        `(archive:${classifyResult.byTier.archive} review:${classifyResult.byTier.review} attention:${classifyResult.byTier.attention})`
      );
    }
    steps.classify = { success: true, durationMs: Date.now() - classifyStart };
    progress?.('classify', 'done', classifyResult.classified > 0
      ? `${classifyResult.classified} emails`
      : undefined);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Heartbeat] Classification failed:', errMsg);
    warnings.push(`Classification failed: ${errMsg}`);
    progress?.('classify', 'error', errMsg);
    steps.classify = { success: false, durationMs: Date.now() - classifyStart, error: errMsg };
  }
}
```

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 4: Run tests**

Run: `npx vitest run`
Expected: Passing (old classify tests may need updating if they imported the old pipeline)

**Step 5: Commit**

```bash
git add src/lib/triage/classify-emails-pipeline.ts src/lib/memory/heartbeat.ts
git commit -m "feat(PER-248): replace 3-tier classification with AI email classifier"
```

---

### Task 6: Add decision logging to triage actions

When a user archives, snoozes, or takes action on an email, log the decision alongside the AI's recommendation for the learning loop.

**Files:**
- Modify: `src/app/api/triage/[id]/route.ts`

**Step 1: Add decision tracking to the archive action**

In `src/app/api/triage/[id]/route.ts`, after the status update in the `archive` action handler, log the decision:

```typescript
// After setting status to 'archived', check if there was an AI recommendation
const classification = item.classification as Record<string, unknown> | null;
if (classification?.recommendation) {
  const wasOverride = classification.recommendation !== 'archive';
  // Log is implicit — the classification column already has the recommendation,
  // and the status column now has the actual action.
  // We enrich the classification with override info:
  await db
    .update(inboxItems)
    .set({
      classification: {
        ...classification,
        actualAction: 'archived',
        wasOverride,
        decidedAt: new Date().toISOString(),
      },
    })
    .where(eq(inboxItems.id, item.id));
}
```

Apply the same pattern for `snooze`, `actioned`, `spam`, `action-needed` actions — each logs its `actualAction` value.

The key insight: we don't need a separate `email_decisions` table. We can store the decision outcome directly in the existing `classification` JSON column, alongside the recommendation. The `getDecisionHistory()` function queries by status, which already captures the user's action.

**Step 2: Run tests**

Run: `npx vitest run src/app/api/triage/__tests__/`
Expected: Existing tests still pass

**Step 3: Commit**

```bash
git add src/app/api/triage/[id]/route.ts
git commit -m "feat(PER-248): log triage decisions for classifier learning loop"
```

---

## Phase 3: Granola Memory Enhancement

### Task 7: Add Supermemory save to Granola sync

**Files:**
- Modify: `src/lib/granola/sync.ts`

**Step 1: Add Supermemory save function**

In `src/lib/granola/sync.ts`, add a function after `saveExtractedMemory()`:

```typescript
import { addMemory } from '@/lib/memory/supermemory';

/**
 * Save a formatted meeting summary to Supermemory
 * for semantic search and email classifier context.
 */
async function saveMeetingToSupermemory(
  title: string,
  attendees: string[],
  extraction: MeetingMemoryExtraction,
  meetingDate: string
): Promise<void> {
  const parts = [
    `Meeting: ${title} (${meetingDate})`,
    attendees.length > 0 ? `Attendees: ${attendees.join(', ')}` : '',
    extraction.summary ? `Summary: ${extraction.summary}` : '',
  ];

  if (extraction.facts.length > 0) {
    parts.push('Key facts:');
    for (const fact of extraction.facts.slice(0, 10)) {
      parts.push(`- ${fact.content}`);
    }
  }

  if (extraction.actionItems.length > 0) {
    parts.push('Action items:');
    for (const item of extraction.actionItems) {
      const assignee = item.assignee ? ` [${item.assignee}]` : '';
      parts.push(`-${assignee} ${item.description}`);
    }
  }

  if (extraction.topics.length > 0) {
    parts.push(`Topics: ${extraction.topics.join(', ')}`);
  }

  const content = parts.filter(Boolean).join('\n');

  await addMemory(content, {
    type: 'meeting',
    source: 'granola',
    title,
    date: meetingDate,
  });
}
```

**Step 2: Call it during sync**

In the sync loop, after `saveExtractedMemory()` (around line 340), add:

```typescript
// Save formatted summary to Supermemory (for semantic search + email classifier)
try {
  const meetingDate = calendarEvent?.start?.dateTime
    ? new Date(calendarEvent.start.dateTime).toLocaleDateString()
    : new Date(doc.created_at).toLocaleDateString();
  const attendeeNames = attendees
    .map((a: { displayName?: string; email?: string }) => a.displayName || a.email)
    .filter(Boolean) as string[];

  await saveMeetingToSupermemory(doc.title, attendeeNames, extractedMemory, meetingDate);
  console.log(`[Granola] Saved meeting summary to Supermemory: ${doc.title}`);
} catch (smError) {
  console.warn(`[Granola] Supermemory save failed (non-blocking):`, smError);
}
```

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/lib/granola/sync.ts
git commit -m "feat(PER-248): save Granola meeting summaries to Supermemory"
```

---

## Phase 4: UI Changes

### Task 8: Update connector tabs to Email + Meetings only

**Files:**
- Modify: `src/hooks/use-triage-navigation.ts`
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Update the connector filter type and values**

In `src/hooks/use-triage-navigation.ts`:

```typescript
// BEFORE (lines 6, 19-25)
export type ConnectorFilter = 'all' | 'gmail' | 'slack' | 'linear' | 'granola';
const CONNECTOR_FILTER_VALUES: ConnectorFilter[] = [
  'all', 'gmail', 'slack', 'linear', 'granola',
];

// AFTER
export type ConnectorFilter = 'gmail' | 'granola';
const CONNECTOR_FILTER_VALUES: ConnectorFilter[] = ['gmail', 'granola'];
```

Update the default filter (line 33):

```typescript
// BEFORE
const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>('all');

// AFTER
const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>('gmail');
```

Update `connectorCounts` (lines 62-70) to remove `all`, `slack`, `linear`:

```typescript
const connectorCounts = useMemo(
  () => ({
    gmail: localItems.filter((i) => i.connector === 'gmail').length,
    granola: localItems.filter((i) => i.connector === 'granola').length,
  }),
  [localItems]
);
```

Update the filter logic (line 39-42) — no more 'all' case:

```typescript
const filteredItems = useMemo(() => {
  return localItems.filter((item) => item.connector === connectorFilter);
}, [localItems, connectorFilter]);
```

**Step 2: Update the connector filter buttons in triage-client.tsx**

In `src/app/triage/triage-client.tsx`, update `CONNECTOR_FILTERS` (lines 41-51):

```typescript
// BEFORE
const CONNECTOR_FILTERS: Array<{
  value: "all" | "gmail" | "slack" | "linear" | "granola";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "all", label: "All", icon: Filter },
  { value: "gmail", label: "Gmail", icon: Mail },
  { value: "slack", label: "Slack", icon: MessageSquare },
  { value: "linear", label: "Linear", icon: LayoutList },
  { value: "granola", label: "Granola", icon: CalendarDays },
];

// AFTER
const CONNECTOR_FILTERS: Array<{
  value: "gmail" | "granola";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "gmail", label: "Email", icon: Mail },
  { value: "granola", label: "Meetings", icon: CalendarDays },
];
```

Update keyboard shortcuts (lines 179-189) — reduce to `⌘1` and `⌘2`:

```typescript
{ key: "1", modifiers: { meta: true }, handler: () => selectConnectorFilter(0) },
{ key: "2", modifiers: { meta: true }, handler: () => selectConnectorFilter(1) },
{ key: "1", modifiers: { ctrl: true }, handler: () => selectConnectorFilter(0) },
{ key: "2", modifiers: { ctrl: true }, handler: () => selectConnectorFilter(1) },
```

Remove the `⌘3`, `⌘4`, `⌘5` bindings.

Remove unused imports: `MessageSquare`, `LayoutList`, `Filter` from lucide-react.

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`
Fix any type errors from the ConnectorFilter change.

**Step 4: Run tests**

Run: `npx vitest run`

**Step 5: Commit**

```bash
git add src/hooks/use-triage-navigation.ts src/app/triage/triage-client.tsx
git commit -m "feat(PER-248): update triage tabs to Email and Meetings only"
```

---

### Task 9: Build confidence tier layout for Email tab

When the connector filter is `gmail`, show emails grouped into three confidence tiers instead of the flat card stack.

**Files:**
- Create: `src/components/aurelius/triage-email-tiers.tsx`
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Create the confidence tier component**

Create `src/components/aurelius/triage-email-tiers.tsx`:

This component takes classified email items and renders them in three sections:

```typescript
'use client';

import { useState, useMemo } from 'react';
import { TriageCard } from './triage-card';
import type { TriageItem } from './triage-card';
import { SuggestedTasksBox } from './suggested-tasks-box';
import { cn } from '@/lib/utils';
import { Archive, Eye, AlertCircle, ChevronDown, ChevronUp, Check } from 'lucide-react';

interface EmailTiersProps {
  items: TriageItem[];
  tasksByItemId: Record<string, unknown[]>;
  onArchive: (item: TriageItem) => void;
  onBulkArchive: (items: TriageItem[]) => void;
  onSelectItem: (item: TriageItem) => void;
  activeItemId?: string;
}

interface ClassifiedItem extends TriageItem {
  recommendation: 'archive' | 'review' | 'attention';
  confidence: number;
  reasoning: string;
}

function getClassification(item: TriageItem): ClassifiedItem {
  const classification = item.classification as Record<string, unknown> | null;
  return {
    ...item,
    recommendation: (classification?.recommendation as string) || 'attention',
    confidence: (classification?.confidence as number) || 0,
    reasoning: (classification?.reasoning as string) || '',
  } as ClassifiedItem;
}

export function TriageEmailTiers({
  items,
  tasksByItemId,
  onArchive,
  onBulkArchive,
  onSelectItem,
  activeItemId,
}: EmailTiersProps) {
  const [archiveTierExpanded, setArchiveTierExpanded] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const classified = useMemo(() => items.map(getClassification), [items]);

  const tiers = useMemo(() => ({
    archive: classified.filter(i => i.recommendation === 'archive' && i.confidence >= 0.90),
    review: classified.filter(i =>
      (i.recommendation === 'archive' && i.confidence < 0.90) ||
      i.recommendation === 'review'
    ),
    attention: classified.filter(i => i.recommendation === 'attention'),
  }), [classified]);

  const archiveReady = tiers.archive.filter(i => !excludedIds.has(i.id));

  const toggleExclude = (id: string) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Tier 1: Ready to archive */}
      {tiers.archive.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-green-500" />
              <h3 className="text-sm font-medium text-foreground">
                Ready to archive
              </h3>
              <span className="text-xs text-muted-foreground px-2 py-0.5 bg-secondary rounded-full">
                {tiers.archive.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setArchiveTierExpanded(!archiveTierExpanded)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {archiveTierExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => onBulkArchive(archiveReady)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Archive All ({archiveReady.length})
              </button>
            </div>
          </div>

          {archiveTierExpanded && (
            <div className="space-y-1 bg-secondary/30 rounded-lg p-3">
              {tiers.archive.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-2 px-3 rounded hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    checked={!excludedIds.has(item.id)}
                    onChange={() => toggleExclude(item.id)}
                    className="rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate">
                        {item.senderName || item.sender}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {item.subject}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {item.reasoning}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Tier 2: Quick review */}
      {tiers.review.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-yellow-500" />
            <h3 className="text-sm font-medium text-foreground">Quick review</h3>
            <span className="text-xs text-muted-foreground px-2 py-0.5 bg-secondary rounded-full">
              {tiers.review.length}
            </span>
          </div>
          <div className="space-y-3">
            {tiers.review.map(item => (
              <div key={item.id} className="relative">
                <div
                  onClick={() => onSelectItem(item)}
                  className={cn(
                    "cursor-pointer rounded-lg border transition-colors",
                    activeItemId === item.id
                      ? "border-gold/50 bg-gold/5"
                      : "border-border/50 hover:border-border"
                  )}
                >
                  <TriageCard item={item} isActive={activeItemId === item.id} />
                  {item.reasoning && (
                    <div className="px-4 pb-3 text-xs text-muted-foreground italic border-t border-border/30 pt-2 mt-1">
                      AI: {item.reasoning}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tier 3: Needs your attention */}
      {tiers.attention.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-medium text-foreground">Needs your attention</h3>
            <span className="text-xs text-muted-foreground px-2 py-0.5 bg-secondary rounded-full">
              {tiers.attention.length}
            </span>
          </div>
          <div className="space-y-3">
            {tiers.attention.map(item => (
              <div key={item.id} className="relative">
                <div
                  onClick={() => onSelectItem(item)}
                  className={cn(
                    "cursor-pointer rounded-lg border transition-colors",
                    activeItemId === item.id
                      ? "border-gold/50 bg-gold/5"
                      : "border-border/50 hover:border-border"
                  )}
                >
                  <TriageCard item={item} isActive={activeItemId === item.id} />
                </div>
                {activeItemId === item.id && (
                  <SuggestedTasksBox
                    itemId={item.dbId || item.id}
                    initialTasks={tasksByItemId[item.dbId || item.id] as any}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Archive className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-serif text-gold">Email inbox clear</h3>
          <p className="text-sm text-muted-foreground mt-1">
            No new emails to triage.
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Integrate into triage-client.tsx**

In `src/app/triage/triage-client.tsx`, when `connectorFilter === 'gmail'`, render the tier layout instead of the card stack. Add a conditional around lines 389-448:

```typescript
import { TriageEmailTiers } from '@/components/aurelius/triage-email-tiers';

// In the render, replace the card area with a conditional:
{!isLoading && hasItems && connectorFilter === 'gmail' && triageView === 'card' && (
  <TriageEmailTiers
    items={filteredItems}
    tasksByItemId={tasksByItemId}
    onArchive={(item) => actions.handleArchive(item)}
    onBulkArchive={(items) => {
      // Archive all items in the batch
      for (const item of items) {
        actions.handleArchive(item);
      }
    }}
    onSelectItem={(item) => {
      const index = filteredItems.findIndex(i => i.id === item.id);
      if (index >= 0) setCurrentIndex(index + batchCardCount);
    }}
    activeItemId={currentItem?.id}
  />
)}

{/* Keep existing card view for Granola (for now — Task 10 replaces this) */}
{!isLoading && hasItems && connectorFilter !== 'gmail' && triageView === 'card' && (
  // ... existing card stack code ...
)}
```

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 4: Manually test in browser**

Run: `bun run dev`
Navigate to `/triage`, verify:
- Email tab shows confidence tiers
- "Archive All" button works
- Items can be excluded from batch archive
- Clicking items in review/attention tiers works

**Step 5: Commit**

```bash
git add src/components/aurelius/triage-email-tiers.tsx src/app/triage/triage-client.tsx
git commit -m "feat(PER-248): confidence tier layout for email triage"
```

---

### Task 10: Build task-focused view for Granola tab

When `connectorFilter === 'granola'`, show meetings grouped by meeting with extracted tasks.

**Files:**
- Create: `src/components/aurelius/triage-meeting-tasks.tsx`
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Create the meeting tasks component**

Create `src/components/aurelius/triage-meeting-tasks.tsx`:

```typescript
'use client';

import { useState, useMemo } from 'react';
import type { TriageItem } from './triage-card';
import { cn } from '@/lib/utils';
import { CalendarDays, Check, X, Pencil, MessageSquare, Archive } from 'lucide-react';

interface MeetingTask {
  id: string;
  description: string;
  assignee?: string;
  assigneeType?: string;
  dueDate?: string;
  confidence?: string;
  status: string;
}

interface MeetingTasksProps {
  items: TriageItem[];
  tasksByItemId: Record<string, MeetingTask[]>;
  onAcceptTask: (taskId: string, itemId: string) => void;
  onDismissTask: (taskId: string, itemId: string) => void;
  onArchiveMeeting: (item: TriageItem) => void;
  onOpenChat: (item: TriageItem) => void;
}

export function TriageMeetingTasks({
  items,
  tasksByItemId,
  onAcceptTask,
  onDismissTask,
  onArchiveMeeting,
  onOpenChat,
}: MeetingTasksProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <CalendarDays className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-serif text-gold">No meetings to review</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Meeting tasks will appear after your next sync.
          </p>
        </div>
      )}

      {items.map(item => {
        const tasks = (tasksByItemId[item.dbId || item.id] || [])
          .filter((t: MeetingTask) =>
            t.status === 'suggested' &&
            (t.assigneeType === 'self' || t.assigneeType === 'unknown')
          );
        const enrichment = item.enrichment as Record<string, unknown> | null;
        const attendees = (enrichment?.attendees as string) || '';
        const meetingTime = (enrichment?.meetingTime as string) || '';

        return (
          <div key={item.id} className="border border-border/50 rounded-lg overflow-hidden">
            {/* Meeting header */}
            <div className="flex items-center justify-between px-4 py-3 bg-secondary/30">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-4 h-4 text-gold" />
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {item.subject}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {meetingTime}
                    {attendees && ` \u00b7 ${attendees}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenChat(item)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Chat about this meeting"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onArchiveMeeting(item)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Done with this meeting"
                >
                  <Archive className="w-3.5 h-3.5" />
                  Done
                </button>
              </div>
            </div>

            {/* Tasks */}
            {tasks.length > 0 ? (
              <div className="divide-y divide-border/30">
                {tasks.map((task: MeetingTask) => (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{task.description}</p>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Due: {task.dueDate}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onAcceptTask(task.id, item.dbId || item.id)}
                        className="p-1.5 rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400 transition-colors"
                        title="Accept \u2192 create Linear task"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDismissTask(task.id, item.dbId || item.id)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-xs text-muted-foreground italic">
                No tasks extracted for you from this meeting.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Integrate into triage-client.tsx**

In the render section of `src/app/triage/triage-client.tsx`, add the Granola view:

```typescript
import { TriageMeetingTasks } from '@/components/aurelius/triage-meeting-tasks';

{/* Granola/Meetings view */}
{!isLoading && hasItems && connectorFilter === 'granola' && (
  <TriageMeetingTasks
    items={filteredItems}
    tasksByItemId={tasksByItemId as Record<string, any>}
    onAcceptTask={(taskId, itemId) => {
      // Accept task via API — creates Linear issue
      fetch(`/api/triage/${itemId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'accept' }),
      }).then(() => mutate());
    }}
    onDismissTask={(taskId, itemId) => {
      fetch(`/api/triage/${itemId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'dismiss' }),
      }).then(() => mutate());
    }}
    onArchiveMeeting={(item) => actions.handleArchive(item)}
    onOpenChat={(item) => {
      const index = filteredItems.findIndex(i => i.id === item.id);
      if (index >= 0) {
        setCurrentIndex(index + batchCardCount);
        setViewMode('chat');
      }
    }}
  />
)}
```

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 4: Manually test in browser**

Navigate to `/triage`, click Meetings tab, verify:
- Meetings show grouped with tasks
- Accept/dismiss buttons work
- Done archives the meeting card
- Chat opens the AI chat overlay

**Step 5: Commit**

```bash
git add src/components/aurelius/triage-meeting-tasks.tsx src/app/triage/triage-client.tsx
git commit -m "feat(PER-248): task-focused meeting view for Granola triage"
```

---

## Phase 5: Cleanup and API Updates

### Task 11: Update triage API to support confidence tiers

The GET `/api/triage` route needs to return classification data for the tier layout to work.

**Files:**
- Modify: `src/app/api/triage/route.ts`

**Step 1: Ensure classification data is included in the response**

The `inbox_items` table already has a `classification` JSON column that the new classifier populates. Verify that the GET handler includes this field in its response. The `getInboxItemsFromDb()` function likely selects all columns, so the classification data should already be flowing through.

If the fetcher strips classification, add it to the item transformation in `use-triage-data.ts`.

**Step 2: Remove batch card fetching for gmail**

In the GET handler, batch cards are no longer relevant for email (they were replaced by confidence tiers). The batch card query can be kept for backward compatibility but won't be rendered for email.

**Step 3: Verify `tsc --noEmit` passes**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/app/api/triage/route.ts
git commit -m "fix(PER-248): ensure classification data flows to triage UI"
```

---

### Task 12: Final verification and type checking

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Fix any remaining issues.

**Step 2: Run full test suite**

Run: `npx vitest run`
Fix any failing tests (especially in `src/lib/triage/__tests__/classify.test.ts` which tests the old pipeline).

**Step 3: Manual E2E test**

1. Trigger a heartbeat: `POST /api/heartbeat`
2. Verify only Gmail and Granola sync (no Linear/Slack)
3. Verify new emails get AI classification with recommendation + confidence + reasoning
4. Open `/triage` — verify Email tab shows confidence tiers
5. Open Meetings tab — verify meetings show with tasks
6. Archive from the "Ready to archive" tier
7. Accept a task from a meeting

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix(PER-248): final cleanup and test fixes for triage redesign"
```

---

## Summary of Deliverables

| Task | What | Key Files |
|------|------|-----------|
| 1 | Remove Linear/Slack from heartbeat | `connectors/index.ts`, `types.ts`, `heartbeat.ts` |
| 2 | Add email:preferences config | `schema/config.ts`, `seed-preferences.ts` |
| 3 | Sender decision history | `decision-history.ts` |
| 4 | AI email classifier | `classify-email.ts` |
| 5 | Replace classification pipeline | `classify-emails-pipeline.ts`, `heartbeat.ts` |
| 6 | Decision logging | `api/triage/[id]/route.ts` |
| 7 | Granola → Supermemory | `granola/sync.ts` |
| 8 | Email + Meetings tabs | `use-triage-navigation.ts`, `triage-client.tsx` |
| 9 | Confidence tier layout | `triage-email-tiers.tsx` |
| 10 | Meeting tasks view | `triage-meeting-tasks.tsx` |
| 11 | API updates | `api/triage/route.ts` |
| 12 | Final verification | All files |
