# Triage Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add smart pre-processing to triage so items are auto-classified into batch action cards, with a tiered AI pipeline (rules → Ollama → Kimi) and a daily learning loop that evolves rules from user behavior.

**Architecture:** New classification step runs in heartbeat after connector syncs. Each new item passes through 3 tiers: deterministic rule match, Ollama local inference, then Kimi cloud analysis for ambiguous items. Classified items accumulate into persistent batch cards (reusing existing action_cards table). A daily Kimi reflection analyzes triage actions and proposes rule changes.

**Tech Stack:** Drizzle ORM (Postgres), Ollama local LLM, OpenRouter/Kimi, Next.js API routes, React components (existing triage card pattern)

**Linear:** PER-219 (parent), PER-220 through PER-226 (child issues)

**Design Doc:** `docs/plans/2026-02-09-triage-enhancements-design.md`

---

## Task 1: DB Schema Evolution (PER-220)

Evolve existing `triageRules` table, add `classification` column to `inbox_items`, create `ai_cost_log` table, add `"batch"` to `card_pattern` enum.

**Files:**
- Modify: `src/lib/db/schema/triage.ts` — evolve triageRules, add classification column
- Modify: `src/lib/db/schema/action-cards.ts` — add "batch" to cardPatternEnum
- Create: `src/lib/db/schema/ai-cost-log.ts` — new table
- Modify: `src/lib/db/schema/index.ts` — export new schema
- Create: `src/lib/triage/__tests__/classification.test.ts` — schema type tests

### Step 1: Evolve the triageRules table

The existing `triageRules` table (`src/lib/db/schema/triage.ts:146-189`) has a basic trigger/action shape. We need to expand it to support our two rule types: structured rules and AI guidance notes.

In `src/lib/db/schema/triage.ts`, replace the existing `triageRules` definition:

```typescript
// Triage rule types
export const ruleTypeEnum = pgEnum("rule_type", ["structured", "guidance"]);

// Triage rule source — how the rule was created
export const ruleSourceEnum = pgEnum("rule_source", [
  "user_chat",      // Typed in batch card chat
  "user_settings",  // Created in settings page
  "daily_learning", // Suggested by daily reflection
  "override",       // Auto-created from repeated overrides
]);

// Triage rules: structured patterns + AI guidance notes
export const triageRules = pgTable(
  "triage_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"), // Human-readable explanation

    // Rule type and content
    type: ruleTypeEnum("type").notNull(),

    // Structured rule: deterministic matching
    trigger: jsonb("trigger").$type<{
      connector?: string;
      sender?: string;
      senderDomain?: string;
      subjectContains?: string;
      contentContains?: string;
      pattern?: string; // regex
    }>(),

    // Structured rule: what to do when matched
    action: jsonb("action").$type<{
      type: "batch";
      batchType: string; // "archive" | "note-archive" | "spam" | "attention" | custom
      label?: string; // Custom batch card title
    }>(),

    // Guidance note: natural language instruction for AI
    guidance: text("guidance"),

    // Metadata
    status: ruleStatusEnum("status").default("active").notNull(),
    source: ruleSourceEnum("source").notNull(),
    version: integer("version").default(1).notNull(),
    createdBy: text("created_by").default("user").notNull(),

    // Stats
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("triage_rules_status_idx").on(table.status)],
);
```

### Step 2: Add classification column to inbox_items

In `src/lib/db/schema/triage.ts`, add to the `inboxItems` table definition, after the `enrichment` field:

```typescript
    // Classification from pre-processing pipeline
    classification: jsonb("classification").$type<{
      batchCardId: string | null; // null = surface individually
      tier: "rule" | "ollama" | "kimi";
      confidence: number;
      reason: string;
      classifiedAt: string; // ISO timestamp
      ruleId?: string; // If classified by a structured rule
    }>(),
```

### Step 3: Add "batch" to cardPatternEnum

In `src/lib/db/schema/action-cards.ts`:

```typescript
export const cardPatternEnum = pgEnum("card_pattern", [
  "approval",
  "config",
  "confirmation",
  "info",
  "vault",
  "code",
  "batch",
]);
```

### Step 4: Create ai_cost_log table

Create `src/lib/db/schema/ai-cost-log.ts`:

```typescript
import { pgTable, text, timestamp, uuid, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { inboxItems } from "./triage";

export const aiCostLog = pgTable("ai_cost_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(), // "ollama" | "kimi"
  operation: text("operation").notNull(), // "classify" | "enrich" | "daily_learning" | "rule_parse"
  itemId: uuid("item_id").references(() => inboxItems.id, { onDelete: "set null" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AiCostLogEntry = typeof aiCostLog.$inferSelect;
export type NewAiCostLogEntry = typeof aiCostLog.$inferInsert;
```

### Step 5: Export from schema index

In `src/lib/db/schema/index.ts`, add:

```typescript
export * from "./ai-cost-log";
```

### Step 6: Generate and apply migration

```bash
npx drizzle-kit generate
```

Then manually review the generated SQL. The migration needs:
- `ALTER TYPE card_pattern ADD VALUE 'batch';`
- `ALTER TYPE rule_source ...` (new enum)
- `ALTER TYPE rule_type ...` (new enum)
- `ALTER TABLE inbox_items ADD COLUMN classification JSONB;`
- `CREATE TABLE ai_cost_log ...`
- `ALTER TABLE triage_rules ...` (add new columns, modify types)

Apply with: `npx drizzle-kit push` or run the SQL directly.

### Step 7: Verify TypeScript compiles

```bash
npx tsc --noEmit
```

### Step 8: Commit

```bash
git add -A && git commit -m "feat: evolve DB schema for triage classification pipeline (PER-220)"
```

---

## Task 2: Rule Library & CRUD (PER-221)

Create the rule management layer: fetch rules, match items, create rules from natural language.

**Files:**
- Create: `src/lib/triage/rules.ts` — rule CRUD, matching logic
- Create: `src/lib/triage/rules-ai.ts` — natural language → rule parsing (Kimi)
- Create: `src/app/api/triage/rules/route.ts` — GET/POST API
- Create: `src/app/api/triage/rules/[id]/route.ts` — PUT/DELETE API
- Create: `src/lib/triage/__tests__/rules.test.ts` — tests

### Step 1: Write failing tests for rule matching

Create `src/lib/triage/__tests__/rules.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { matchRule } from "../rules";

const mockItem = {
  connector: "gmail",
  sender: "bot@github.com",
  senderName: "GitHub",
  subject: "[aurelius-hq] PR #42 merged",
  content: "Your pull request was merged.",
};

describe("matchRule", () => {
  it("matches by sender", () => {
    const rule = {
      type: "structured" as const,
      trigger: { sender: "bot@github.com" },
      action: { type: "batch" as const, batchType: "archive" },
    };
    expect(matchRule(rule, mockItem)).toBe(true);
  });

  it("matches by connector", () => {
    const rule = {
      type: "structured" as const,
      trigger: { connector: "gmail" },
      action: { type: "batch" as const, batchType: "archive" },
    };
    expect(matchRule(rule, mockItem)).toBe(true);
  });

  it("matches by sender domain", () => {
    const rule = {
      type: "structured" as const,
      trigger: { senderDomain: "github.com" },
      action: { type: "batch" as const, batchType: "archive" },
    };
    expect(matchRule(rule, mockItem)).toBe(true);
  });

  it("matches by subject keyword", () => {
    const rule = {
      type: "structured" as const,
      trigger: { subjectContains: "PR" },
      action: { type: "batch" as const, batchType: "archive" },
    };
    expect(matchRule(rule, mockItem)).toBe(true);
  });

  it("requires ALL trigger fields to match", () => {
    const rule = {
      type: "structured" as const,
      trigger: { sender: "bot@github.com", connector: "slack" },
      action: { type: "batch" as const, batchType: "archive" },
    };
    expect(matchRule(rule, mockItem)).toBe(false);
  });

  it("skips guidance rules", () => {
    const rule = {
      type: "guidance" as const,
      guidance: "Always surface GitHub PRs",
    };
    expect(matchRule(rule, mockItem)).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/lib/triage/__tests__/rules.test.ts
```

Expected: FAIL — `matchRule` not found.

### Step 3: Implement rule matching and CRUD

Create `src/lib/triage/rules.ts`:

```typescript
import { db } from "@/lib/db";
import { triageRules, type TriageRule } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface RuleMatchInput {
  connector: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  content: string;
}

interface StructuredRule {
  type: "structured";
  trigger?: {
    connector?: string;
    sender?: string;
    senderDomain?: string;
    subjectContains?: string;
    contentContains?: string;
    pattern?: string;
  };
  action?: {
    type: "batch";
    batchType: string;
    label?: string;
  };
}

interface GuidanceRule {
  type: "guidance";
  guidance?: string | null;
}

type RuleLike = StructuredRule | GuidanceRule;

/** Check if an item matches a structured rule. Returns false for guidance rules. */
export function matchRule(rule: RuleLike, item: RuleMatchInput): boolean {
  if (rule.type !== "structured") return false;
  const trigger = rule.trigger;
  if (!trigger) return false;

  // All specified fields must match (AND logic)
  if (trigger.connector && trigger.connector !== item.connector) return false;
  if (trigger.sender && trigger.sender !== item.sender) return false;
  if (trigger.senderDomain) {
    const domain = item.sender.split("@")[1];
    if (domain !== trigger.senderDomain) return false;
  }
  if (trigger.subjectContains) {
    if (!item.subject.toLowerCase().includes(trigger.subjectContains.toLowerCase())) return false;
  }
  if (trigger.contentContains) {
    if (!item.content.toLowerCase().includes(trigger.contentContains.toLowerCase())) return false;
  }
  if (trigger.pattern) {
    const regex = new RegExp(trigger.pattern, "i");
    if (!regex.test(item.subject) && !regex.test(item.content)) return false;
  }

  return true;
}

/** Get all active rules */
export async function getActiveRules(): Promise<TriageRule[]> {
  return db
    .select()
    .from(triageRules)
    .where(eq(triageRules.status, "active"));
}

/** Get all rules (for settings page) */
export async function getAllRules(): Promise<TriageRule[]> {
  return db.select().from(triageRules);
}

/** Get guidance notes only (for AI prompt context) */
export async function getGuidanceNotes(): Promise<string[]> {
  const rules = await getActiveRules();
  return rules
    .filter((r) => r.type === "guidance" && r.guidance)
    .map((r) => r.guidance!);
}

/** Create a new rule */
export async function createRule(
  rule: Omit<typeof triageRules.$inferInsert, "id" | "createdAt" | "updatedAt">
): Promise<TriageRule> {
  const [created] = await db.insert(triageRules).values(rule).returning();
  return created;
}

/** Update a rule */
export async function updateRule(
  id: string,
  updates: Partial<typeof triageRules.$inferInsert>
): Promise<TriageRule | null> {
  const [updated] = await db
    .update(triageRules)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(triageRules.id, id))
    .returning();
  return updated ?? null;
}

/** Delete a rule */
export async function deleteRule(id: string): Promise<boolean> {
  const result = await db
    .delete(triageRules)
    .where(eq(triageRules.id, id))
    .returning();
  return result.length > 0;
}

/** Increment match count for a rule */
export async function incrementRuleMatchCount(id: string): Promise<void> {
  const rule = await db
    .select()
    .from(triageRules)
    .where(eq(triageRules.id, id))
    .limit(1);
  if (rule.length > 0) {
    await db
      .update(triageRules)
      .set({
        matchCount: rule[0].matchCount + 1,
        lastMatchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(triageRules.id, id));
  }
}
```

### Step 4: Run tests

```bash
npx vitest run src/lib/triage/__tests__/rules.test.ts
```

Expected: PASS

### Step 5: Create natural language rule parser

Create `src/lib/triage/rules-ai.ts`:

```typescript
import { chat } from "@/lib/ai/client";
import { logAiCost } from "./ai-cost";

const PARSE_RULE_PROMPT = `You parse natural language into triage rules. Given a user instruction about how to handle their inbox items, return a JSON object.

If the instruction describes a simple pattern (specific sender, domain, connector, keyword), return a structured rule:
{
  "type": "structured",
  "name": "<short name>",
  "description": "<what this rule does>",
  "trigger": { "sender?": "...", "senderDomain?": "...", "connector?": "...", "subjectContains?": "...", "contentContains?": "..." },
  "action": { "type": "batch", "batchType": "archive|note-archive|spam|attention", "label?": "custom label" }
}

If the instruction is nuanced or context-dependent, return a guidance note:
{
  "type": "guidance",
  "name": "<short name>",
  "description": "<what this guidance does>",
  "guidance": "<the instruction rephrased as a clear directive>"
}

Return ONLY valid JSON, no markdown fences.`;

export async function parseNaturalLanguageRule(input: string): Promise<{
  type: "structured" | "guidance";
  name: string;
  description: string;
  trigger?: Record<string, string>;
  action?: Record<string, string>;
  guidance?: string;
}> {
  const response = await chat(
    `User instruction: "${input}"`,
    PARSE_RULE_PROMPT
  );

  await logAiCost({
    provider: "kimi",
    operation: "rule_parse",
    result: { input, parsed: response },
  });

  return JSON.parse(response);
}
```

### Step 6: Create API routes

Create `src/app/api/triage/rules/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getAllRules, createRule } from "@/lib/triage/rules";
import { parseNaturalLanguageRule } from "@/lib/triage/rules-ai";

export async function GET() {
  const rules = await getAllRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const body = await request.json();

  // Natural language input
  if (body.input && typeof body.input === "string") {
    const parsed = await parseNaturalLanguageRule(body.input);
    const rule = await createRule({
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      trigger: parsed.trigger ?? null,
      action: parsed.action ?? null,
      guidance: parsed.guidance ?? null,
      source: body.source || "user_chat",
      createdBy: "user",
    });
    return NextResponse.json({ rule, parsed: true });
  }

  // Direct rule creation
  const rule = await createRule({
    name: body.name,
    description: body.description,
    type: body.type,
    trigger: body.trigger ?? null,
    action: body.action ?? null,
    guidance: body.guidance ?? null,
    source: body.source || "user_settings",
    createdBy: body.createdBy || "user",
  });
  return NextResponse.json({ rule });
}
```

Create `src/app/api/triage/rules/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { updateRule, deleteRule } from "@/lib/triage/rules";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const rule = await updateRule(id, body);
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  return NextResponse.json({ rule });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteRule(id);
  if (!deleted) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

### Step 7: Verify and commit

```bash
npx vitest run src/lib/triage/__tests__/rules.test.ts
npx tsc --noEmit
git add -A && git commit -m "feat: rule library with CRUD, matching, and NL parsing (PER-221)"
```

---

## Task 3: AI Cost Logging (PER-225)

Lightweight cost tracking for every Ollama and Kimi call in the classification pipeline.

**Files:**
- Create: `src/lib/triage/ai-cost.ts` — logging functions
- Create: `src/app/api/triage/ai-costs/route.ts` — GET API for dashboard

### Step 1: Create cost logging utility

Create `src/lib/triage/ai-cost.ts`:

```typescript
import { db } from "@/lib/db";
import { aiCostLog, type NewAiCostLogEntry } from "@/lib/db/schema";
import { desc, sql, gte } from "drizzle-orm";

// Rough cost estimates per 1K tokens (USD)
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  ollama: { input: 0, output: 0 }, // Local, free
  kimi: { input: 0.0006, output: 0.0024 }, // Approximate OpenRouter pricing
};

export async function logAiCost(entry: {
  provider: string;
  operation: string;
  itemId?: string;
  inputTokens?: number;
  outputTokens?: number;
  result?: Record<string, unknown>;
}): Promise<void> {
  const costs = COST_PER_1K[entry.provider] ?? { input: 0, output: 0 };
  const estimatedCost =
    ((entry.inputTokens ?? 0) / 1000) * costs.input +
    ((entry.outputTokens ?? 0) / 1000) * costs.output;

  await db.insert(aiCostLog).values({
    provider: entry.provider,
    operation: entry.operation,
    itemId: entry.itemId ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    estimatedCost: estimatedCost.toFixed(6),
    result: entry.result ?? null,
  });
}

export async function getCostSummary(days: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({
      provider: aiCostLog.provider,
      operation: aiCostLog.operation,
      totalInputTokens: sql<number>`sum(${aiCostLog.inputTokens})::int`,
      totalOutputTokens: sql<number>`sum(${aiCostLog.outputTokens})::int`,
      totalCost: sql<string>`sum(${aiCostLog.estimatedCost})`,
      count: sql<number>`count(*)::int`,
    })
    .from(aiCostLog)
    .where(gte(aiCostLog.createdAt, since))
    .groupBy(aiCostLog.provider, aiCostLog.operation);

  return rows;
}

export async function getRecentCosts(limit: number = 50) {
  return db
    .select()
    .from(aiCostLog)
    .orderBy(desc(aiCostLog.createdAt))
    .limit(limit);
}
```

### Step 2: Create API route

Create `src/app/api/triage/ai-costs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCostSummary, getRecentCosts } from "@/lib/triage/ai-cost";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7");

  const [summary, recent] = await Promise.all([
    getCostSummary(days),
    getRecentCosts(50),
  ]);

  return NextResponse.json({ summary, recent });
}
```

### Step 3: Verify and commit

```bash
npx tsc --noEmit
git add -A && git commit -m "feat: AI cost logging utility and API (PER-225)"
```

---

## Task 4: Classification Pipeline (PER-222)

The core engine: classify new items through rules → Ollama → Kimi. Runs as a new heartbeat step.

**Files:**
- Create: `src/lib/triage/classify.ts` — main pipeline
- Create: `src/lib/triage/classify-ollama.ts` — Ollama classification prompt
- Create: `src/lib/triage/classify-kimi.ts` — Kimi classification + enrichment
- Modify: `src/lib/memory/heartbeat.ts` — add classification step
- Create: `src/lib/triage/__tests__/classify.test.ts` — tests

### Step 1: Write failing test for Pass 1 (rule matching)

Create `src/lib/triage/__tests__/classify.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {},
  triageRules: {},
  aiCostLog: {},
  actionCards: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  isNull: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
  gte: vi.fn(),
}));

vi.mock("@/lib/memory/ollama", () => ({
  isOllamaAvailable: vi.fn().mockResolvedValue(true),
  generate: vi.fn().mockResolvedValue('{"batchType": "archive", "confidence": 0.9, "reason": "Routine notification"}'),
}));

vi.mock("@/lib/ai/client", () => ({
  chat: vi.fn().mockResolvedValue('{"batchType": "archive", "confidence": 0.95, "reason": "Routine notification", "enrichment": {"summary": "Test"}}'),
}));

import { classifyItem, ClassificationResult } from "../classify";
import { matchRule } from "../rules";

describe("classifyItem", () => {
  it("returns rule classification when a structured rule matches", async () => {
    const item = {
      id: "item-1",
      connector: "gmail",
      sender: "bot@github.com",
      senderName: "GitHub",
      subject: "PR merged",
      content: "Your PR was merged",
    };

    const rules = [
      {
        id: "rule-1",
        type: "structured" as const,
        trigger: { sender: "bot@github.com" },
        action: { type: "batch" as const, batchType: "archive" },
        guidance: null,
        status: "active" as const,
      },
    ];

    const result = await classifyItem(item, rules);

    expect(result.tier).toBe("rule");
    expect(result.batchType).toBe("archive");
    expect(result.ruleId).toBe("rule-1");
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/lib/triage/__tests__/classify.test.ts
```

### Step 3: Implement classification pipeline

Create `src/lib/triage/classify.ts`:

```typescript
import { db } from "@/lib/db";
import { inboxItems, type InboxItem } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { matchRule, getActiveRules, incrementRuleMatchCount, getGuidanceNotes } from "./rules";
import { classifyWithOllama } from "./classify-ollama";
import { classifyWithKimi } from "./classify-kimi";
import { logAiCost } from "./ai-cost";

export interface ClassificationResult {
  batchType: string | null; // null = surface individually
  tier: "rule" | "ollama" | "kimi";
  confidence: number;
  reason: string;
  ruleId?: string;
  enrichment?: Record<string, unknown>; // Kimi enrichment data
}

interface ClassifyInput {
  id: string;
  connector: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  content: string;
  enrichment?: Record<string, unknown> | null;
}

const OLLAMA_CONFIDENCE_THRESHOLD = 0.7;

/** Classify a single item through the 3-pass pipeline */
export async function classifyItem(
  item: ClassifyInput,
  rules?: Awaited<ReturnType<typeof getActiveRules>>
): Promise<ClassificationResult> {
  // Fetch rules if not provided
  const activeRules = rules ?? await getActiveRules();

  // Pass 1: Rule matching (instant, deterministic)
  for (const rule of activeRules) {
    if (rule.type !== "structured") continue;
    const matched = matchRule(
      {
        type: rule.type,
        trigger: rule.trigger as any,
        action: rule.action as any,
      },
      {
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        content: item.content,
      }
    );
    if (matched) {
      // Fire-and-forget match count increment
      incrementRuleMatchCount(rule.id).catch(() => {});
      const action = rule.action as { type: string; batchType: string; label?: string };
      return {
        batchType: action.batchType,
        tier: "rule",
        confidence: 1.0,
        reason: `Matched rule: ${rule.name}`,
        ruleId: rule.id,
      };
    }
  }

  // Pass 2: Ollama (local, cheap)
  try {
    const guidanceNotes = activeRules
      .filter((r) => r.type === "guidance" && r.guidance)
      .map((r) => r.guidance!);

    const ollamaResult = await classifyWithOllama(item, guidanceNotes);

    if (ollamaResult && ollamaResult.confidence >= OLLAMA_CONFIDENCE_THRESHOLD) {
      return {
        batchType: ollamaResult.batchType,
        tier: "ollama",
        confidence: ollamaResult.confidence,
        reason: ollamaResult.reason,
      };
    }
    // Fall through to Kimi if low confidence
  } catch (error) {
    console.warn("[Classify] Ollama failed, falling through to Kimi:", error);
  }

  // Pass 3: Kimi (cloud, smart — also enriches)
  try {
    const guidanceNotes = activeRules
      .filter((r) => r.type === "guidance" && r.guidance)
      .map((r) => r.guidance!);

    const kimiResult = await classifyWithKimi(item, guidanceNotes);
    return {
      batchType: kimiResult.batchType,
      tier: "kimi",
      confidence: kimiResult.confidence,
      reason: kimiResult.reason,
      enrichment: kimiResult.enrichment,
    };
  } catch (error) {
    console.error("[Classify] Kimi failed:", error);
    // Fallback: surface individually
    return {
      batchType: null,
      tier: "kimi",
      confidence: 0,
      reason: "Classification failed — surfacing individually",
    };
  }
}

/** Classify all unclassified new items. Called from heartbeat. */
export async function classifyNewItems(): Promise<{
  classified: number;
  byTier: { rule: number; ollama: number; kimi: number };
}> {
  // Fetch unclassified new items
  const unclassified = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, "new"),
        isNull(inboxItems.classification)
      )
    );

  if (unclassified.length === 0) {
    return { classified: 0, byTier: { rule: 0, ollama: 0, kimi: 0 } };
  }

  console.log(`[Classify] Processing ${unclassified.length} unclassified items`);

  // Fetch rules once for all items
  const rules = await getActiveRules();
  const byTier = { rule: 0, ollama: 0, kimi: 0 };

  for (const item of unclassified) {
    const result = await classifyItem(
      {
        id: item.id,
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        content: item.content,
        enrichment: item.enrichment as Record<string, unknown> | null,
      },
      rules
    );

    // Save classification to item
    const classification = {
      batchCardId: null as string | null, // Set by batch card creation step
      tier: result.tier,
      confidence: result.confidence,
      reason: result.reason,
      classifiedAt: new Date().toISOString(),
      ruleId: result.ruleId,
    };

    // If Kimi returned enrichment, merge it
    const updates: Record<string, unknown> = {
      classification,
      updatedAt: new Date(),
    };
    if (result.enrichment && result.tier === "kimi") {
      updates.enrichment = {
        ...(item.enrichment as Record<string, unknown> ?? {}),
        ...result.enrichment,
      };
    }

    await db
      .update(inboxItems)
      .set(updates)
      .where(eq(inboxItems.id, item.id));

    byTier[result.tier]++;
  }

  return { classified: unclassified.length, byTier };
}
```

### Step 4: Create Ollama classifier

Create `src/lib/triage/classify-ollama.ts`:

```typescript
import { isOllamaAvailable, generate } from "@/lib/memory/ollama";
import { logAiCost } from "./ai-cost";

interface ClassifyInput {
  id: string;
  connector: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  content: string;
}

interface OllamaClassification {
  batchType: string | null;
  confidence: number;
  reason: string;
}

const OLLAMA_CLASSIFY_PROMPT = `You are a triage classifier. Given an inbox item, classify it into one of these categories:
- "archive": Routine notifications, bot messages, newsletters, auto-generated emails that need no attention
- "note-archive": Worth knowing about but no action needed (FYI emails, status updates)
- "spam": Spam, marketing, phishing
- "attention": Needs attention but can be reviewed as a group
- null: Needs individual attention — important, personal, or ambiguous

USER GUIDANCE NOTES (follow these):
{GUIDANCE}

ITEM:
Connector: {CONNECTOR}
From: {SENDER} ({SENDER_NAME})
Subject: {SUBJECT}
Content (first 500 chars): {CONTENT}

Return ONLY a JSON object:
{"batchType": "archive"|"note-archive"|"spam"|"attention"|null, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

export async function classifyWithOllama(
  item: ClassifyInput,
  guidanceNotes: string[]
): Promise<OllamaClassification | null> {
  if (!(await isOllamaAvailable())) return null;

  const guidanceText = guidanceNotes.length > 0
    ? guidanceNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")
    : "None yet.";

  const prompt = OLLAMA_CLASSIFY_PROMPT
    .replace("{GUIDANCE}", guidanceText)
    .replace("{CONNECTOR}", item.connector)
    .replace("{SENDER}", item.sender)
    .replace("{SENDER_NAME}", item.senderName || "Unknown")
    .replace("{SUBJECT}", item.subject)
    .replace("{CONTENT}", item.content.slice(0, 500));

  const response = await generate(prompt, { temperature: 0.1 });

  await logAiCost({
    provider: "ollama",
    operation: "classify",
    itemId: item.id,
    result: { raw: response },
  });

  try {
    return JSON.parse(response);
  } catch {
    console.warn("[Classify/Ollama] Failed to parse response:", response);
    return null;
  }
}
```

### Step 5: Create Kimi classifier

Create `src/lib/triage/classify-kimi.ts`:

```typescript
import { chat } from "@/lib/ai/client";
import { logAiCost } from "./ai-cost";

interface ClassifyInput {
  id: string;
  connector: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  content: string;
  enrichment?: Record<string, unknown> | null;
}

interface KimiClassification {
  batchType: string | null;
  confidence: number;
  reason: string;
  enrichment: {
    summary?: string;
    suggestedPriority?: string;
    suggestedTags?: string[];
  };
}

const KIMI_CLASSIFY_PROMPT = `You are a triage classifier and enrichment engine. Given an inbox item, do TWO things:

1. CLASSIFY it into a batch type:
   - "archive": Routine, no attention needed
   - "note-archive": Worth noting, no action needed
   - "spam": Spam/marketing
   - "attention": Important but can be group-reviewed
   - null: Needs individual attention

2. ENRICH it with:
   - summary: 1-sentence summary
   - suggestedPriority: "urgent"|"high"|"normal"|"low"
   - suggestedTags: relevant tags array

USER GUIDANCE NOTES:
{GUIDANCE}

Return ONLY JSON:
{"batchType": ..., "confidence": 0.0-1.0, "reason": "...", "enrichment": {"summary": "...", "suggestedPriority": "...", "suggestedTags": [...]}}`;

export async function classifyWithKimi(
  item: ClassifyInput,
  guidanceNotes: string[]
): Promise<KimiClassification> {
  const guidanceText = guidanceNotes.length > 0
    ? guidanceNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")
    : "None yet.";

  const prompt = KIMI_CLASSIFY_PROMPT.replace("{GUIDANCE}", guidanceText);

  const input = `Connector: ${item.connector}
From: ${item.sender} (${item.senderName || "Unknown"})
Subject: ${item.subject}
Content: ${item.content.slice(0, 1500)}`;

  const response = await chat(input, prompt);

  await logAiCost({
    provider: "kimi",
    operation: "classify",
    itemId: item.id,
    result: { raw: response },
  });

  return JSON.parse(response);
}
```

### Step 6: Wire into heartbeat

In `src/lib/memory/heartbeat.ts`, add a Step 6 after Slack sync:

```typescript
import { classifyNewItems } from '@/lib/triage/classify';
```

Add to `HeartbeatStep` type: `'classify'`

Add to `HeartbeatOptions`: `skipClassify?: boolean;`

Add to `HeartbeatResult`: `classify?: { classified: number; byTier: { rule: number; ollama: number; kimi: number } };`

Add step after Slack (before the totalDuration calculation):

```typescript
  // Step 6: Classify new triage items
  if (!options.skipClassify) {
    progress?.('classify', 'start');
    const classifyStart = Date.now();
    try {
      const classifyResult = await classifyNewItems();
      if (classifyResult.classified > 0) {
        console.log(`[Heartbeat] Classify: ${classifyResult.classified} items (rule:${classifyResult.byTier.rule} ollama:${classifyResult.byTier.ollama} kimi:${classifyResult.byTier.kimi})`);
      }
      steps.classify = {
        success: true,
        durationMs: Date.now() - classifyStart,
      };
      progress?.('classify', 'done', classifyResult.classified > 0 ? `${classifyResult.classified} items` : undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Classification failed:', errMsg);
      warnings.push(`Classification failed: ${errMsg}`);
      progress?.('classify', 'error', errMsg);
      steps.classify = {
        success: false,
        durationMs: Date.now() - classifyStart,
        error: errMsg,
      };
    }
  }
```

### Step 7: Run tests and verify

```bash
npx vitest run src/lib/triage/__tests__/classify.test.ts
npx tsc --noEmit
git add -A && git commit -m "feat: 3-pass classification pipeline in heartbeat (PER-222)"
```

---

## Task 5: Batch Card Creation & Persistence (PER-223)

After classification, group items into persistent batch cards.

**Files:**
- Create: `src/lib/triage/batch-cards.ts` — create/update batch cards from classifications
- Modify: `src/lib/triage/classify.ts` — call batch card creation after classifying
- Modify: `src/app/api/triage/route.ts` — return batch cards in GET response

### Step 1: Create batch card manager

Create `src/lib/triage/batch-cards.ts`:

```typescript
import { db } from "@/lib/db";
import { actionCards, inboxItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateCardId } from "@/lib/action-cards/db";

interface BatchCardInput {
  batchType: string;
  items: Array<{
    id: string;
    sender: string;
    senderName?: string | null;
    subject: string;
    enrichment?: Record<string, unknown> | null;
    classification?: Record<string, unknown> | null;
  }>;
}

/** Default batch card configs */
const BATCH_CARD_DEFAULTS: Record<string, { title: string; action: string; explanation: string }> = {
  archive: {
    title: "Archive these",
    action: "archive",
    explanation: "Routine notifications and messages that don't need your attention.",
  },
  "note-archive": {
    title: "Note & archive",
    action: "archive",
    explanation: "Worth knowing about but no action needed. Review the summaries and archive.",
  },
  spam: {
    title: "Likely spam",
    action: "archive",
    explanation: "These look like spam or unsolicited marketing.",
  },
  attention: {
    title: "Quick review",
    action: "review",
    explanation: "These need attention but can be reviewed as a group.",
  },
};

/** Find or create a batch card for a given batch type */
export async function getOrCreateBatchCard(batchType: string): Promise<string> {
  // Look for existing pending batch card of this type
  const existing = await db
    .select()
    .from(actionCards)
    .where(
      and(
        eq(actionCards.pattern, "batch"),
        eq(actionCards.status, "pending"),
        sql`${actionCards.data}->>'batchType' = ${batchType}`
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Create new batch card
  const defaults = BATCH_CARD_DEFAULTS[batchType] ?? {
    title: batchType,
    action: "archive",
    explanation: `Grouped items: ${batchType}`,
  };

  const cardId = generateCardId();
  await db.insert(actionCards).values({
    id: cardId,
    pattern: "batch",
    status: "pending",
    title: defaults.title,
    handler: "batch:action",
    data: {
      batchType,
      action: defaults.action,
      explanation: defaults.explanation,
      itemCount: 0,
    },
  });

  return cardId;
}

/** Assign classified items to batch cards. Called after classifyNewItems. */
export async function assignItemsToBatchCards(): Promise<{
  assigned: number;
  cards: Record<string, number>;
}> {
  // Find items with classification but no batchCardId
  const items = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, "new"),
        sql`${inboxItems.classification} IS NOT NULL`,
        sql`${inboxItems.classification}->>'batchCardId' IS NULL`,
        sql`${inboxItems.classification}->>'batchType' IS NOT NULL`
      )
    );

  if (items.length === 0) return { assigned: 0, cards: {} };

  // Group by batch type
  const byType: Record<string, typeof items> = {};
  for (const item of items) {
    const classification = item.classification as { batchType: string };
    const bt = classification.batchType;
    if (!byType[bt]) byType[bt] = [];
    byType[bt].push(item);
  }

  const cardCounts: Record<string, number> = {};

  for (const [batchType, batchItems] of Object.entries(byType)) {
    const cardId = await getOrCreateBatchCard(batchType);

    // Update each item's classification with the batch card ID
    for (const item of batchItems) {
      const classification = item.classification as Record<string, unknown>;
      await db
        .update(inboxItems)
        .set({
          classification: { ...classification, batchCardId: cardId },
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, item.id));
    }

    // Update card item count
    const totalCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxItems)
      .where(sql`${inboxItems.classification}->>'batchCardId' = ${cardId}`);

    await db
      .update(actionCards)
      .set({
        data: sql`jsonb_set(${actionCards.data}, '{itemCount}', ${totalCount[0]?.count ?? 0}::text::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(actionCards.id, cardId));

    cardCounts[batchType] = batchItems.length;
  }

  return { assigned: items.length, cards: cardCounts };
}

/** Get batch cards with their items for the triage UI */
export async function getBatchCardsWithItems() {
  const cards = await db
    .select()
    .from(actionCards)
    .where(
      and(
        eq(actionCards.pattern, "batch"),
        eq(actionCards.status, "pending")
      )
    );

  const result = [];
  for (const card of cards) {
    const items = await db
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.status, "new"),
          sql`${inboxItems.classification}->>'batchCardId' = ${card.id}`
        )
      );

    result.push({
      ...card,
      items: items.map((item) => ({
        id: item.id,
        externalId: item.externalId,
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        summary: (item.enrichment as any)?.summary ?? null,
        tier: (item.classification as any)?.tier ?? null,
        confidence: (item.classification as any)?.confidence ?? null,
      })),
    });
  }

  return result.filter((c) => c.items.length > 0);
}

/** Action a batch card: apply action to checked items, release unchecked ones */
export async function actionBatchCard(
  cardId: string,
  checkedItemIds: string[],
  uncheckedItemIds: string[]
): Promise<void> {
  const card = await db
    .select()
    .from(actionCards)
    .where(eq(actionCards.id, cardId))
    .limit(1);

  if (card.length === 0) throw new Error("Batch card not found");

  const action = (card[0].data as any)?.action;

  // Apply action to checked items
  if (checkedItemIds.length > 0 && action === "archive") {
    for (const id of checkedItemIds) {
      await db
        .update(inboxItems)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(inboxItems.id, id));
    }
  }

  // Release unchecked items back to individual triage
  if (uncheckedItemIds.length > 0) {
    for (const id of uncheckedItemIds) {
      await db
        .update(inboxItems)
        .set({
          classification: null,
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, id));
    }
  }

  // Mark card as confirmed
  await db
    .update(actionCards)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(actionCards.id, cardId));
}
```

### Step 2: Wire batch card assignment into classification

In `src/lib/triage/classify.ts`, at the end of `classifyNewItems()`, after the classification loop, add:

```typescript
import { assignItemsToBatchCards } from "./batch-cards";

// ... at the end of classifyNewItems():
  // Assign classified items to batch cards
  const batchResult = await assignItemsToBatchCards();
  if (batchResult.assigned > 0) {
    console.log(`[Classify] Assigned ${batchResult.assigned} items to batch cards:`, batchResult.cards);
  }
```

### Step 3: Update triage GET API to include batch cards

In `src/app/api/triage/route.ts`, add batch cards to the response:

```typescript
import { getBatchCardsWithItems } from "@/lib/triage/batch-cards";

// In the GET handler, add to the Promise.all:
const [dbItems, statsRows, senderCountRows, batchCards] = await Promise.all([
  // ... existing queries ...
  getBatchCardsWithItems(),
]);

// Add to response:
return NextResponse.json({
  items: queue.slice(0, limit),
  batchCards,
  // ... rest of existing response
});
```

### Step 4: Create batch card action API

Create `src/app/api/triage/batch/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { actionBatchCard } from "@/lib/triage/batch-cards";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { checkedItemIds, uncheckedItemIds } = await request.json();

  await actionBatchCard(id, checkedItemIds || [], uncheckedItemIds || []);

  return NextResponse.json({ success: true });
}
```

### Step 5: Verify and commit

```bash
npx tsc --noEmit
git add -A && git commit -m "feat: batch card creation, persistence, and action API (PER-223)"
```

---

## Task 6: Batch Card UI (PER-224)

Triage card variant for batch actions with inline item list, checkboxes, and keyboard multi-select.

**Files:**
- Create: `src/components/aurelius/triage-batch-card.tsx` — batch card component
- Modify: `src/components/aurelius/triage-card.tsx` — render batch cards before individual items
- Modify: `src/app/(app)/triage/page.tsx` or parent component — pass batch cards data

This task requires exploring the existing triage page component to understand how cards are rendered and where to inject batch cards. The implementation should:

1. Create `TriageBatchCard` component that renders in triage card format but with:
   - Distinct visual treatment (background tint, left border accent color)
   - Header: title + count + explanation line
   - Inline item list with checkboxes (all checked by default)
   - AI tier badge per item ("Rule", "Ollama", "Kimi")
   - One-line summary per item
   - Action button at bottom
   - Chat input for rule refinement

2. Keyboard interaction when batch card is active:
   - `j`/`k` or `↑`/`↓` — navigate items
   - `Space` — toggle checkbox
   - `Shift+Space` — range select
   - `a` — check all
   - `n` — uncheck all
   - `←` — execute batch action

3. Wire into the triage page so batch cards appear first, before individual items.

4. Connect chat input to POST `/api/triage/rules` with `{ input: "...", source: "user_chat" }`.

5. On batch action execution, POST to `/api/triage/batch/[id]` with checked/unchecked item IDs.

**Note:** This is the largest UI task. Implementation details depend on the exact structure of the triage page component — read it first before coding.

### Commit

```bash
npx tsc --noEmit
npx vitest run
git add -A && git commit -m "feat: batch card UI with keyboard multi-select (PER-224)"
```

---

## Task 7: Daily Learning Loop (PER-226)

Daily Kimi reflection analyzes triage actions and suggests rule changes.

**Files:**
- Create: `src/lib/triage/daily-learning.ts` — reflection logic
- Modify: `src/lib/memory/heartbeat.ts` — add daily learning step (runs once/day)
- Create: `src/app/api/triage/learning/route.ts` — manual trigger API

### Step 1: Create daily learning module

Create `src/lib/triage/daily-learning.ts`:

```typescript
import { db } from "@/lib/db";
import { activityLog, inboxItems, triageRules, actionCards } from "@/lib/db/schema";
import { gte, desc, eq, and, sql } from "drizzle-orm";
import { chat } from "@/lib/ai/client";
import { logAiCost } from "./ai-cost";
import { createRule, getAllRules } from "./rules";
import { generateCardId } from "@/lib/action-cards/db";

const LEARNING_PROMPT = `You are analyzing a user's triage behavior over the last 24 hours to suggest automation rules.

CURRENT RULES:
{RULES}

TRIAGE ACTIONS (last 24h):
{ACTIONS}

BATCH CARD OVERRIDES (items user unchecked from batch actions):
{OVERRIDES}

Based on these patterns, suggest rule changes. For each suggestion:
1. Explain the pattern you see
2. Propose a specific rule (structured or guidance)
3. Rate confidence (0-1)

Return JSON array:
[
  {
    "type": "new_rule",
    "ruleType": "structured"|"guidance",
    "name": "rule name",
    "description": "what it does",
    "trigger": {...} or null,
    "action": {...} or null,
    "guidance": "..." or null,
    "confidence": 0.8,
    "reasoning": "You archived all 8 Linear notifications from..."
  },
  {
    "type": "refine_rule",
    "ruleId": "existing-rule-id",
    "change": "description of change",
    "confidence": 0.7,
    "reasoning": "You keep pulling out urgent bugs from..."
  }
]

If no suggestions, return [].`;

export async function runDailyLearning(): Promise<{
  suggestions: number;
  cardId: string | null;
}> {
  const since = new Date();
  since.setDate(since.getDate() - 1);

  // Gather triage actions from last 24h
  const actions = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.eventType, "triage_action"),
        gte(activityLog.createdAt, since)
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(200);

  if (actions.length === 0) {
    console.log("[Learning] No triage actions in last 24h, skipping");
    return { suggestions: 0, cardId: null };
  }

  // Get current rules
  const rules = await getAllRules();

  // Format for prompt
  const rulesText = rules.length > 0
    ? rules.map((r) => `- [${r.type}] ${r.name}: ${r.description || r.guidance || JSON.stringify(r.trigger)}`).join("\n")
    : "None yet.";

  const actionsText = actions
    .map((a) => `${a.description} (${a.createdAt?.toISOString()})`)
    .join("\n");

  const prompt = LEARNING_PROMPT
    .replace("{RULES}", rulesText)
    .replace("{ACTIONS}", actionsText)
    .replace("{OVERRIDES}", "None tracked yet."); // TODO: track overrides

  const response = await chat(prompt, "Analyze triage patterns and suggest rules.");

  await logAiCost({
    provider: "kimi",
    operation: "daily_learning",
    result: { response },
  });

  let suggestions;
  try {
    suggestions = JSON.parse(response);
  } catch {
    console.warn("[Learning] Failed to parse Kimi response");
    return { suggestions: 0, cardId: null };
  }

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return { suggestions: 0, cardId: null };
  }

  // Create a batch card with the suggestions
  const cardId = generateCardId();
  await db.insert(actionCards).values({
    id: cardId,
    pattern: "batch",
    status: "pending",
    title: `Aurelius learned ${suggestions.length} new pattern${suggestions.length > 1 ? "s" : ""} yesterday`,
    handler: "batch:learning",
    data: {
      batchType: "learning",
      suggestions,
      explanation: "Review these suggested rules based on your triage behavior.",
    },
  });

  return { suggestions: suggestions.length, cardId };
}
```

### Step 2: Wire into heartbeat (daily check)

In `src/lib/memory/heartbeat.ts`, add a daily learning step similar to backup (runs once/day). Use a simple date check or config flag.

### Step 3: Create manual trigger API

Create `src/app/api/triage/learning/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { runDailyLearning } from "@/lib/triage/daily-learning";

export async function POST() {
  const result = await runDailyLearning();
  return NextResponse.json(result);
}
```

### Step 4: Verify and commit

```bash
npx tsc --noEmit
git add -A && git commit -m "feat: daily learning loop with rule suggestions (PER-226)"
```

---

## Verification

After all tasks:

```bash
npx vitest run          # All tests pass
npx tsc --noEmit        # TypeScript clean
```

Manual smoke test:
1. Trigger heartbeat → check that new items get classified
2. Open triage → batch cards appear at top
3. Action a batch card → items archived, unchecked items appear individually
4. Type a rule in batch card chat → rule created
5. Trigger heartbeat again → new items follow the rule
6. Check settings → AI costs visible
7. Trigger daily learning → suggestions card appears
