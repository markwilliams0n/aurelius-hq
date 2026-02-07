# Vault Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first document library and fact store with AI classification, opt-in SuperMemory sync, and architectural sensitive data gating.

**Architecture:** New `vault_items` table (no embeddings — SM handles semantic search, vault uses PostgreSQL full-text). Vault capability with `save_to_vault` + `search_vault` tools. Dedicated vault page with AI input + file upload. Files stored on local filesystem (`data/vault/files/`), text extracted into DB for search. Sensitive values never enter AI context — revealed only via client-side API call.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL full-text search, Ollama (classification + summaries), Supermemory SDK, pdf-parse, mammoth, lucide-react icons, Tailwind CSS v4.

**Design doc:** `docs/plans/2026-02-07-vault-design.md`

---

## Task 1: DB Schema & Migration

Creates the vault_items table, enums, and indexes. Foundation for everything else.

**Files:**
- Create: `src/lib/db/schema/vault.ts`
- Modify: `src/lib/db/schema/index.ts` — add vault export
- Modify: `src/lib/db/schema/config.ts` — add `capability:vault` to configKeyEnum

**Step 1: Create vault schema file**

Create `src/lib/db/schema/vault.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const vaultItemTypeEnum = pgEnum("vault_item_type", [
  "document",
  "fact",
  "credential",
  "reference",
]);

export const supermemoryStatusEnum = pgEnum("supermemory_status", [
  "none",
  "pending",
  "sent",
]);

export const vaultItems = pgTable(
  "vault_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: vaultItemTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: text("content"), // searchable text — always populated
    filePath: text("file_path"), // local filesystem path for binary files
    fileName: text("file_name"), // original filename
    contentType: text("content_type"), // MIME type
    sensitive: boolean("sensitive").default(false).notNull(),
    tags: text("tags").array().default([]).notNull(),
    sourceUrl: text("source_url"),

    // SuperMemory sync tracking
    supermemoryStatus: supermemoryStatusEnum("supermemory_status")
      .default("none")
      .notNull(),
    supermemoryLevel: text("supermemory_level"), // 'short' | 'medium' | 'detailed' | 'full'
    supermemorySummary: text("supermemory_summary"), // what was sent

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("vault_items_tags_idx").using("gin", table.tags),
    index("vault_items_created_idx").on(table.createdAt),
  ]
);

export type VaultItem = typeof vaultItems.$inferSelect;
export type NewVaultItem = typeof vaultItems.$inferInsert;
```

**Note on full-text search index:** Drizzle doesn't support GIN indexes on `to_tsvector()` expressions directly. Add it in the migration SQL manually after generating (see Step 4).

**Note on file storage:** Design doc says BYTEA, but since this is a local app with a cloud Neon DB, storing binaries over the network is slow and expensive. Use local filesystem instead (`data/vault/files/`), store path in DB. The `content` column holds extracted text for search.

**Step 2: Export from schema index**

Add to `src/lib/db/schema/index.ts`:

```typescript
export * from "./vault";
```

**Step 3: Add capability:vault config key**

In `src/lib/db/schema/config.ts`, add `"capability:vault"` to the configKeyEnum array.

**Step 4: Generate and fix migration**

```bash
bunx drizzle-kit generate
```

Then edit the generated migration SQL to add the full-text search index after the CREATE TABLE:

```sql
CREATE INDEX idx_vault_items_search ON "vault_items" USING GIN (to_tsvector('english', "title" || ' ' || COALESCE("content", '')));
```

Also add the config key enum value:

```sql
ALTER TYPE "public"."config_key" ADD VALUE 'capability:vault';
```

**Step 5: Run migration**

```bash
bunx drizzle-kit push
```

Or start the dev server — migrations auto-apply.

**Step 6: Verify**

```bash
bunx tsc --noEmit
```

**Step 7: Commit**

```
feat: vault DB schema — vault_items table, enums, config key
```

---

## Task 2: Vault Library

Core CRUD, search, and file storage functions. No AI yet — just data operations.

**Files:**
- Create: `src/lib/vault/index.ts`
- Create: `src/lib/vault/files.ts`

**Step 1: Create file storage utility**

Create `src/lib/vault/files.ts`:

```typescript
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const VAULT_DIR = path.join(process.cwd(), "data", "vault", "files");

/** Ensure vault directory exists */
async function ensureDir() {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

/** Save a file to the vault directory, return the path */
export async function saveFile(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  await ensureDir();
  const ext = path.extname(originalName);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(VAULT_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/** Read a file from the vault directory */
export async function readFile(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

/** Delete a file from the vault directory */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}
```

Also add `data/vault/` to `.gitignore`.

**Step 2: Create vault library**

Create `src/lib/vault/index.ts`:

```typescript
import { db } from "@/lib/db";
import { vaultItems, type VaultItem, type NewVaultItem } from "@/lib/db/schema/vault";
import { eq, desc, sql, and, arrayContains } from "drizzle-orm";

/** Create a new vault item */
export async function createVaultItem(
  item: Omit<NewVaultItem, "id" | "createdAt" | "updatedAt">
): Promise<VaultItem> {
  const [created] = await db
    .insert(vaultItems)
    .values(item)
    .returning();
  return created;
}

/** Get a vault item by ID */
export async function getVaultItem(id: string): Promise<VaultItem | null> {
  const [item] = await db
    .select()
    .from(vaultItems)
    .where(eq(vaultItems.id, id))
    .limit(1);
  return item ?? null;
}

/** Get a vault item by ID, including sensitive content (for reveal endpoint only) */
export async function getVaultItemForReveal(
  id: string
): Promise<{ content: string | null; title: string; type: string } | null> {
  const [item] = await db
    .select({
      content: vaultItems.content,
      title: vaultItems.title,
      type: vaultItems.type,
    })
    .from(vaultItems)
    .where(and(eq(vaultItems.id, id), eq(vaultItems.sensitive, true)))
    .limit(1);
  return item ?? null;
}

/** List recent vault items */
export async function listRecentVaultItems(
  limit: number = 20
): Promise<VaultItem[]> {
  return db
    .select()
    .from(vaultItems)
    .orderBy(desc(vaultItems.createdAt))
    .limit(limit);
}

/** Full-text search vault items */
export async function searchVaultItems(
  query: string,
  filters?: { tags?: string[]; type?: string }
): Promise<VaultItem[]> {
  const conditions = [
    sql`to_tsvector('english', ${vaultItems.title} || ' ' || COALESCE(${vaultItems.content}, '')) @@ plainto_tsquery('english', ${query})`,
  ];

  if (filters?.tags?.length) {
    conditions.push(arrayContains(vaultItems.tags, filters.tags));
  }
  if (filters?.type) {
    conditions.push(eq(vaultItems.type, filters.type as any));
  }

  return db
    .select()
    .from(vaultItems)
    .where(and(...conditions))
    .orderBy(desc(vaultItems.createdAt))
    .limit(20);
}

/** Update a vault item */
export async function updateVaultItem(
  id: string,
  updates: Partial<Pick<VaultItem, "title" | "tags" | "sensitive" | "type" | "content" | "supermemoryStatus" | "supermemoryLevel" | "supermemorySummary">>
): Promise<VaultItem | null> {
  const [updated] = await db
    .update(vaultItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(vaultItems.id, id))
    .returning();
  return updated ?? null;
}

/** Get all unique tags across vault items */
export async function getAllTags(): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT DISTINCT unnest(tags) as tag FROM vault_items ORDER BY tag`
  );
  return (result.rows as { tag: string }[]).map((r) => r.tag);
}
```

**Step 3: Verify**

```bash
bunx tsc --noEmit
```

**Step 4: Commit**

```
feat: vault library — CRUD, full-text search, file storage
```

---

## Task 3: Ollama Vault Classification

Adds a classification function that takes content and returns suggested title, type, tags, and sensitive flag.

**Files:**
- Create: `src/lib/vault/classify.ts`

**Step 1: Create classification function**

Create `src/lib/vault/classify.ts`:

```typescript
import { generate, isOllamaAvailable } from "@/lib/memory/ollama";
import { getAllTags } from "@/lib/vault";

export interface VaultClassification {
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  sensitive: boolean;
}

const SENSITIVE_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,          // SSN
  /\b\d{9}\b/,                       // 9-digit numbers (SSN, passport)
  /\b[A-Z]\d{8}\b/,                  // US passport
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card
];

/** Classify a vault item using Ollama + pattern matching */
export async function classifyVaultItem(
  content: string,
  hints?: { title?: string; type?: string; sensitive?: boolean }
): Promise<VaultClassification> {
  // Pattern-based sensitive detection as baseline
  const patternSensitive = SENSITIVE_PATTERNS.some((p) => p.test(content));

  const existingTags = await getAllTags();

  const available = await isOllamaAvailable();
  if (!available) {
    // Fallback: no AI, use pattern detection + defaults
    return {
      title: hints?.title || content.slice(0, 60).trim(),
      type: (hints?.type as VaultClassification["type"]) || (patternSensitive ? "credential" : "fact"),
      tags: [],
      sensitive: hints?.sensitive ?? patternSensitive,
    };
  }

  const prompt = `Classify this item for a personal vault/filing system.

Content (first 500 chars):
${content.slice(0, 500)}

Existing tags in the system: [${existingTags.join(", ")}]
${hints?.title ? `User-provided title: ${hints.title}` : ""}
${hints?.type ? `User-suggested type: ${hints.type}` : ""}

Respond with ONLY a JSON object:
{
  "title": "short descriptive title (3-8 words)",
  "type": "document|fact|credential|reference",
  "tags": ["tag1", "tag2"],
  "sensitive": true/false
}

Rules:
- Prefer existing tags when they fit. Only suggest new tags if nothing fits.
- Max 4 tags.
- "credential" type = contains a specific number/ID (passport, SSN, account number, membership number)
- "fact" type = a piece of information without a specific ID number
- "document" type = longer text content (policy, agreement, certificate)
- "reference" type = a link or pointer to something elsewhere
- "sensitive" = true if it contains SSN, passport numbers, financial account numbers, or other identity-theft-risk data
- Title should be descriptive: "State Farm Auto Insurance Policy", "US Passport Number", "AA Frequent Flyer Number"`;

  const response = await generate(prompt, { temperature: 0.1, maxTokens: 200 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(
      jsonMatch[0].replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]")
    );

    return {
      title: hints?.title || parsed.title || content.slice(0, 60).trim(),
      type: parsed.type || "fact",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : [],
      sensitive: hints?.sensitive ?? parsed.sensitive ?? patternSensitive,
    };
  } catch {
    return {
      title: hints?.title || content.slice(0, 60).trim(),
      type: (hints?.type as VaultClassification["type"]) || (patternSensitive ? "credential" : "fact"),
      tags: [],
      sensitive: hints?.sensitive ?? patternSensitive,
    };
  }
}
```

**Step 2: Verify**

```bash
bunx tsc --noEmit
```

**Step 3: Commit**

```
feat: vault Ollama classification — title, type, tags, sensitive detection
```

---

## Task 4: Vault Capability

Agent tools for saving and searching vault items. Follows the existing capability pattern exactly.

**Files:**
- Create: `src/lib/capabilities/vault/index.ts`
- Modify: `src/lib/capabilities/index.ts` — register vault capability
- Modify: `src/lib/config.ts` — add description for capability:vault

**Step 1: Create vault capability**

Create `src/lib/capabilities/vault/index.ts`:

```typescript
import type { Capability, ToolDefinition, ToolResult } from "../types";
import { createVaultItem, getVaultItem, searchVaultItems, getAllTags } from "@/lib/vault";
import { classifyVaultItem } from "@/lib/vault/classify";

const PROMPT = `# Vault — Document & Fact Storage
You can save and retrieve documents, facts, and credentials using the vault tools.

## save_to_vault
Use when the user says "save my...", "vault this...", "remember my...", or provides a document/fact to store.
- Always include the actual content/value
- You can suggest a title, type, and tags — or let the AI classify automatically

## search_vault
Use when the user says "what's my...", "find my...", "look up my..."
- Search by keywords, or use a vault_item_id for direct lookup
- IMPORTANT: For sensitive items (SSN, passport numbers, etc.), the tool returns metadata only.
  The actual value appears in an action card below the chat — NEVER print sensitive values in your response text.
- For non-sensitive items, you can reference the value directly in your response.`;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "save_to_vault",
    description:
      "Save a document, fact, or credential to the vault. Returns an action card confirming what was saved.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The actual content or value to save",
        },
        title: {
          type: "string",
          description: "Optional title (AI will generate one if not provided)",
        },
        type: {
          type: "string",
          enum: ["document", "fact", "credential", "reference"],
          description: "Item type (AI will infer if not provided)",
        },
        sensitive: {
          type: "boolean",
          description: "Whether this contains sensitive data like SSN, passport numbers",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (AI will suggest if not provided)",
        },
        sourceUrl: {
          type: "string",
          description: "Optional source URL",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_vault",
    description:
      "Search the vault for saved documents, facts, and credentials. Sensitive items return metadata only — values shown in action cards.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        id: {
          type: "string",
          description: "Direct lookup by vault item ID (from SuperMemory recall)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags",
        },
        type: {
          type: "string",
          enum: ["document", "fact", "credential", "reference"],
          description: "Filter by type",
        },
      },
    },
  },
];

async function handleVaultTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult | null> {
  if (toolName === "save_to_vault") {
    return handleSave(toolInput);
  }
  if (toolName === "search_vault") {
    return handleSearch(toolInput);
  }
  return null;
}

async function handleSave(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const content = String(input.content || "");
  if (!content) {
    return { result: JSON.stringify({ error: "Content is required" }) };
  }

  // Classify with Ollama
  const classification = await classifyVaultItem(content, {
    title: input.title as string | undefined,
    type: input.type as string | undefined,
    sensitive: input.sensitive as boolean | undefined,
  });

  // Merge user-provided tags with AI suggestions
  const userTags = Array.isArray(input.tags) ? (input.tags as string[]) : [];
  const mergedTags = [...new Set([...userTags, ...classification.tags])];

  // Save to DB
  const item = await createVaultItem({
    type: classification.type,
    title: classification.title,
    content,
    sensitive: classification.sensitive,
    tags: mergedTags,
    sourceUrl: input.sourceUrl as string | undefined,
  });

  return {
    result: JSON.stringify({
      action_card: {
        pattern: "info",
        handler: null,
        title: `Saved to Vault: ${item.title}`,
        data: {
          vault_item_id: item.id,
          title: item.title,
          type: item.type,
          tags: item.tags,
          sensitive: item.sensitive,
          supermemoryStatus: item.supermemoryStatus,
        },
      },
      summary: `Saved "${item.title}" to vault`,
    }),
  };
}

async function handleSearch(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const id = input.id as string | undefined;
  const query = input.query as string | undefined;

  // Direct lookup by ID
  if (id) {
    const item = await getVaultItem(id);
    if (!item) {
      return { result: JSON.stringify({ error: "Vault item not found" }) };
    }
    return formatSearchResult(item);
  }

  // Text search
  if (!query) {
    return { result: JSON.stringify({ error: "Either query or id is required" }) };
  }

  const results = await searchVaultItems(query, {
    tags: input.tags as string[] | undefined,
    type: input.type as string | undefined,
  });

  if (results.length === 0) {
    return { result: JSON.stringify({ found: false, message: "No vault items matched your search" }) };
  }

  // Return first result (most relevant)
  // If multiple, include count
  const primary = results[0];
  const response = await formatSearchResult(primary);

  if (results.length > 1) {
    const parsed = JSON.parse(response.result);
    parsed.additional_results = results.length - 1;
    return { result: JSON.stringify(parsed) };
  }

  return response;
}

function formatSearchResult(item: typeof import("@/lib/db/schema/vault").vaultItems.$inferSelect): ToolResult {
  if (item.sensitive) {
    // Sensitive: metadata only, value in action card
    return {
      result: JSON.stringify({
        found: true,
        title: item.title,
        type: item.type,
        tags: item.tags,
        sensitive: true,
        vault_item_id: item.id,
        message: "Sensitive item found — value shown in card below. Do NOT print the value in your response.",
        action_card: {
          pattern: "info",
          handler: null,
          title: `Vault: ${item.title}`,
          data: {
            vault_item_id: item.id,
            sensitive: true,
            title: item.title,
            type: item.type,
            tags: item.tags,
          },
        },
      }),
    };
  }

  // Non-sensitive: return full content
  return {
    result: JSON.stringify({
      found: true,
      title: item.title,
      type: item.type,
      tags: item.tags,
      content: item.content,
      sensitive: false,
      vault_item_id: item.id,
    }),
  };
}

export const vaultCapability: Capability = {
  name: "vault",
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleVaultTool,
};
```

**Step 2: Register capability**

In `src/lib/capabilities/index.ts`, add:

```typescript
import { vaultCapability } from './vault';

const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
  slackCapability,
  vaultCapability,  // add
];
```

**Step 3: Add config description**

In `src/lib/config.ts`, add to `CONFIG_DESCRIPTIONS`:

```typescript
"capability:vault": "Instructions for the Vault capability — how the agent saves and retrieves documents, facts, and credentials.",
```

**Step 4: Verify**

```bash
bunx tsc --noEmit
```

**Step 5: Commit**

```
feat: vault capability — save_to_vault and search_vault agent tools
```

---

## Task 5: Vault API Routes

REST endpoints for the vault page and client-side operations.

**Files:**
- Create: `src/app/api/vault/items/route.ts` — GET (list/search) + POST (create)
- Create: `src/app/api/vault/items/[id]/route.ts` — GET + PATCH
- Create: `src/app/api/vault/items/[id]/reveal/route.ts` — GET (sensitive value)
- Create: `src/app/api/vault/tags/route.ts` — GET
- Create: `src/app/api/vault/upload/route.ts` — POST (file upload)
- Create: `src/app/api/vault/items/[id]/supermemory/route.ts` — POST
- Create: `src/app/api/vault/chat/route.ts` — POST

**Step 1: Items list/search + create**

Create `src/app/api/vault/items/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listRecentVaultItems, searchVaultItems, createVaultItem } from "@/lib/vault";
import { classifyVaultItem } from "@/lib/vault/classify";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const tagsParam = url.searchParams.get("tags");
  const type = url.searchParams.get("type");

  if (query) {
    const tags = tagsParam ? tagsParam.split(",") : undefined;
    const items = await searchVaultItems(query, { tags, type: type || undefined });
    return NextResponse.json({ items });
  }

  const items = await listRecentVaultItems();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { content, title, type, sensitive, tags, sourceUrl } = body;

  if (!content) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  const classification = await classifyVaultItem(content, { title, type, sensitive });
  const mergedTags = [...new Set([...(tags || []), ...classification.tags])];

  const item = await createVaultItem({
    type: classification.type,
    title: classification.title,
    content,
    sensitive: classification.sensitive,
    tags: mergedTags,
    sourceUrl,
  });

  return NextResponse.json({ item });
}
```

**Step 2: Item get + update**

Create `src/app/api/vault/items/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVaultItem, updateVaultItem } from "@/lib/vault";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await getVaultItem(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If sensitive, strip content from response (use /reveal endpoint)
  if (item.sensitive) {
    return NextResponse.json({
      item: { ...item, content: "[SENSITIVE — use reveal endpoint]" },
    });
  }

  return NextResponse.json({ item });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { title, tags, sensitive, type } = body;

  const item = await updateVaultItem(id, { title, tags, sensitive, type });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ item });
}
```

**Step 3: Reveal endpoint**

Create `src/app/api/vault/items/[id]/reveal/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVaultItemForReveal } from "@/lib/vault";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await getVaultItemForReveal(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ content: item.content, title: item.title });
}
```

**Step 4: Tags endpoint**

Create `src/app/api/vault/tags/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAllTags } from "@/lib/vault";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tags = await getAllTags();
  return NextResponse.json({ tags });
}
```

**Step 5: Vault chat route**

Create `src/app/api/vault/chat/route.ts`:

Follow the triage chat pattern: takes a message + history, loads vault-only context, returns response + action data. Use `buildAgentContext()` with vault-specific additional context. Parse action JSON from response. No memory extraction on this surface.

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildAgentContext } from "@/lib/ai/context";
import { chat } from "@/lib/ai/client";
import { handleToolCall } from "@/lib/capabilities";
import { createCard, generateCardId } from "@/lib/action-cards/db";
import type { CardPattern } from "@/lib/db/schema/action-cards";

const VAULT_CONTEXT = `You are in VAULT MODE. This is a secure document filing surface.
Your only tools here are save_to_vault and search_vault.
When the user provides content, save it to the vault immediately using save_to_vault.
When the user asks about saved items, use search_vault.
NEVER print sensitive values in your response text — they appear in action cards only.`;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { message, history = [] } = await request.json();
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  const { systemPrompt } = await buildAgentContext({
    query: message,
    additionalContext: VAULT_CONTEXT,
  });

  const messages = [
    ...history.slice(-10).map((h: { role: string; content: string }) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: message },
  ];

  const result = await chat(messages, systemPrompt);

  let response = result;
  let actionCard = null;

  // Check for action_card JSON in tool results embedded in response
  const cardMatch = response.match(/\{"action_card"[\s\S]*\}\s*$/);
  if (cardMatch) {
    try {
      const parsed = JSON.parse(cardMatch[0]);
      if (parsed.action_card) {
        actionCard = await createCard({
          id: generateCardId(),
          pattern: (parsed.action_card.pattern || "info") as CardPattern,
          status: "pending",
          title: parsed.action_card.title || "Vault",
          data: parsed.action_card.data || {},
          handler: parsed.action_card.handler || null,
        });
        response = response.replace(cardMatch[0], "").trim();
      }
    } catch {
      // Not valid JSON — ignore
    }
  }

  return NextResponse.json({ response, actionCard });
}
```

**Note:** The chat route needs refinement during implementation — the exact tool call flow depends on how `chat()` vs `chatStreamWithTools()` handle tool responses. The key pattern is: vault capability returns action_card in tool result → route persists card → client renders card.

**Step 6: Verify**

```bash
bunx tsc --noEmit
```

**Step 7: Commit**

```
feat: vault API routes — items CRUD, reveal, tags, chat
```

---

## Task 6: File Upload & Text Extraction

Adds file upload endpoint + PDF/DOCX text extraction.

**Files:**
- Create: `src/app/api/vault/upload/route.ts`
- Create: `src/lib/vault/extract.ts`

**Step 1: Install dependencies**

```bash
bun add pdf-parse mammoth
```

**Step 2: Create text extraction module**

Create `src/lib/vault/extract.ts`:

```typescript
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

/** Extract text content from a file buffer based on MIME type */
export async function extractText(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<string> {
  switch (contentType) {
    case "application/pdf": {
      const pdf = await pdfParse(buffer);
      return pdf.text || fileName;
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || fileName;
    }
    case "text/plain":
    case "text/markdown":
    case "text/csv": {
      return buffer.toString("utf-8");
    }
    default: {
      // Unknown type — use filename as content for searchability
      return fileName;
    }
  }
}
```

**Step 3: Create upload route**

Create `src/app/api/vault/upload/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createVaultItem } from "@/lib/vault";
import { saveFile } from "@/lib/vault/files";
import { extractText } from "@/lib/vault/extract";
import { classifyVaultItem } from "@/lib/vault/classify";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const fileName = file.name;

  // Save file to disk
  const filePath = await saveFile(buffer, fileName);

  // Extract text for search
  const textContent = await extractText(buffer, contentType, fileName);

  // Classify with Ollama
  const classification = await classifyVaultItem(textContent, {
    type: "document",
  });

  // Save to DB
  const item = await createVaultItem({
    type: "document",
    title: classification.title,
    content: textContent,
    filePath,
    fileName,
    contentType,
    sensitive: classification.sensitive,
    tags: classification.tags,
  });

  return NextResponse.json({ item });
}
```

**Step 4: Verify**

```bash
bunx tsc --noEmit
```

**Step 5: Commit**

```
feat: vault file upload — PDF/DOCX text extraction, filesystem storage
```

---

## Task 7: SuperMemory Integration

Summary generation via Ollama + send to SuperMemory with vault linkage.

**Files:**
- Create: `src/lib/vault/supermemory.ts`
- Create: `src/app/api/vault/items/[id]/supermemory/route.ts`

**Step 1: Create summary generation + send module**

Create `src/lib/vault/supermemory.ts`:

```typescript
import { generate, isOllamaAvailable } from "@/lib/memory/ollama";
import { addMemory } from "@/lib/memory/supermemory";
import { getVaultItem, updateVaultItem } from "@/lib/vault";

export type SummaryLevel = "short" | "medium" | "detailed" | "full";

/** Generate a summary of a vault item at a given level using Ollama */
export async function generateSummary(
  itemId: string,
  level: SummaryLevel
): Promise<string> {
  const item = await getVaultItem(itemId);
  if (!item) throw new Error("Vault item not found");

  // Full level: return content as-is (minus sensitive values)
  if (level === "full") {
    if (item.sensitive) {
      return `[Vault item: ${item.title}] ${item.content?.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]").replace(/\b[A-Z]\d{8}\b/g, "[REDACTED]") || item.title}`;
    }
    return item.content || item.title;
  }

  const available = await isOllamaAvailable();
  if (!available) {
    // Fallback: return title + type as short summary
    return `${item.title} (${item.type})`;
  }

  const sensitiveNote = item.sensitive
    ? "\nIMPORTANT: This item is marked SENSITIVE. Do NOT include the actual sensitive value (numbers, IDs, account numbers) in the summary. Describe what it is without the value."
    : "";

  const levelInstructions: Record<SummaryLevel, string> = {
    short: "Write a ONE-LINE summary (max 20 words). Just the essential fact.",
    medium: "Write a PARAGRAPH summary with key details (dates, amounts, parties involved). 2-4 sentences.",
    detailed: "Write a DETAILED summary covering all important information. Multiple paragraphs if needed.",
    full: "", // handled above
  };

  const prompt = `Summarize this vault item for long-term memory storage.

Title: ${item.title}
Type: ${item.type}
Tags: ${item.tags.join(", ")}
Content:
${item.content?.slice(0, 2000) || "[no text content]"}

${levelInstructions[level]}${sensitiveNote}

Write ONLY the summary, no preamble:`;

  return generate(prompt, { temperature: 0.2, maxTokens: level === "detailed" ? 1000 : 300 });
}

/** Send a vault item summary to SuperMemory */
export async function sendToSupermemory(
  itemId: string,
  summary: string,
  level: SummaryLevel
): Promise<void> {
  const item = await getVaultItem(itemId);
  if (!item) throw new Error("Vault item not found");

  await addMemory(summary, {
    vault_item_id: item.id,
    vault_type: item.type,
    sensitive: item.sensitive,
    summary_level: level,
    source: "vault",
  });

  await updateVaultItem(itemId, {
    supermemoryStatus: "sent",
    supermemoryLevel: level,
    supermemorySummary: summary,
  });
}
```

**Step 2: Create SuperMemory API route**

Create `src/app/api/vault/items/[id]/supermemory/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateSummary, sendToSupermemory, type SummaryLevel } from "@/lib/vault/supermemory";

// POST with action=preview → generates summary preview
// POST with action=send → sends to SuperMemory
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { action, level, summary: editedSummary } = await request.json();

  if (!level || !["short", "medium", "detailed", "full"].includes(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  if (action === "preview") {
    const summary = await generateSummary(id, level as SummaryLevel);
    return NextResponse.json({ summary });
  }

  if (action === "send") {
    const finalSummary = editedSummary || await generateSummary(id, level as SummaryLevel);
    await sendToSupermemory(id, finalSummary, level as SummaryLevel);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
```

**Step 3: Verify**

```bash
bunx tsc --noEmit
```

**Step 4: Commit**

```
feat: vault SuperMemory integration — summary generation and opt-in send
```

---

## Task 8: Vault Page UI

The `/vault` page with AI input, file upload, action cards, search, tag filters, and recent items.

**Files:**
- Modify: `src/components/aurelius/app-sidebar.tsx` — add Vault nav item
- Create: `src/app/vault/page.tsx` — server component
- Create: `src/app/vault/vault-client.tsx` — client component
- Create: `src/components/aurelius/vault-item-card.tsx` — item display component
- Create: `src/components/aurelius/cards/vault-card.tsx` — vault action card renderer

**Step 1: Add to sidebar**

In `src/components/aurelius/app-sidebar.tsx`, add to navItems array:

```typescript
import { Archive } from "lucide-react"; // or FileArchive, Vault, etc.

// Add after Tasks:
{ href: "/vault", icon: Archive, label: "Vault" },
```

**Step 2: Create vault page**

Create `src/app/vault/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import VaultClient from "./vault-client";

export default async function VaultPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <VaultClient />;
}
```

**Step 3: Create vault client component**

Create `src/app/vault/vault-client.tsx` — this is the main component. Key sections:

1. **State**: query, tags filter, items list, active action cards, chat history, uploading flag
2. **AI Input**: textarea at top with upload button and send button
3. **Action Cards area**: renders transient cards from AI responses
4. **Search + tag filter**: search input + clickable tag chips
5. **Items list**: recent items, each expandable

The component should:
- Fetch recent items on mount (`GET /api/vault/items`)
- Fetch tags on mount (`GET /api/vault/tags`)
- Send AI messages to `POST /api/vault/chat`
- Handle file uploads via `POST /api/vault/upload`
- Support drag-and-drop on the input area
- Render vault-specific action cards for save confirmations and reveals
- Support inline editing of item title/tags
- Show SuperMemory options on each item (preview → edit → approve flow)

**Key UI patterns to follow:**
- Use the existing `AppShell` wrapper (same as other pages)
- Use Tailwind CSS v4 classes matching existing app styling
- Use `lucide-react` icons for type indicators (FileText, Key, Link, Hash)
- Use `Lock` icon for sensitive items
- Tag chips: small rounded pills, clickable for filtering
- Toast notifications via `sonner` for save/send confirmations

**Step 4: Create vault item card component**

Create `src/components/aurelius/vault-item-card.tsx`:

Individual vault item display with:
- Type icon + lock icon (if sensitive)
- Title (click to edit inline)
- Tags as chips (click to edit, add/remove)
- Date
- Expand to show: full content (or reveal button for sensitive), SM status, SM send options
- SM flow: click level → shows loading → shows preview → edit textarea → approve/cancel

**Step 5: Create vault action card renderer**

Create `src/components/aurelius/cards/vault-card.tsx`:

For rendering vault-specific action cards in chat:
- Save confirmation card: shows title, type, tags (editable), sensitive flag, SM options
- Reveal card: fetches sensitive value from `/api/vault/items/{id}/reveal` and displays it

Register in `approval-card.tsx` or the card rendering switch:

```tsx
if (card.data?.vault_item_id) {
  return <VaultCardContent card={card} />;
}
```

**Step 6: Verify**

```bash
bunx tsc --noEmit
```

Test manually:
1. Navigate to `/vault` in browser
2. Type "Save my passport number X12345678" → should see action card
3. Upload a text file → should auto-classify and show in recents
4. Search for "passport" → should find item
5. Click reveal on sensitive item → should show value in card

**Step 7: Commit**

```
feat: vault page — AI input, file upload, search, tag filters, item cards
```

---

## Task 9: Sensitive Reveal Flow in Chat

Wire up the sensitive reveal action card so it works in main chat when `search_vault` finds a sensitive item.

**Files:**
- Modify: `src/components/aurelius/cards/vault-card.tsx` — ensure reveal card works in chat context
- Modify: `src/app/api/chat/route.ts` — ensure vault tool results with action_cards are persisted (should already work via existing pattern)

**Step 1: Verify chat integration**

The vault capability is already registered (Task 4). The main chat route already handles `action_card` in tool results and persists them. Verify this works end-to-end:

1. In main chat, type "What's my passport number?"
2. AI calls `search_vault` → returns metadata only for sensitive item
3. Tool result includes `action_card` with `vault_item_id`
4. Chat route persists card
5. Client renders VaultRevealCard
6. Card fetches value from `/api/vault/items/{id}/reveal`

**Step 2: Test and fix any issues**

The main integration points that might need adjustment:
- VaultRevealCard needs to handle being rendered in the chat context (inside the chat message stream)
- The `info` pattern card should display without confirm/dismiss buttons
- The reveal fetch should happen on a "Reveal" button click, not automatically

**Step 3: Commit** (if changes needed)

```
fix: vault sensitive reveal flow in main chat
```

---

## Execution Order & Dependencies

```
Task 1 (Schema)
  └→ Task 2 (Library)
       ├→ Task 3 (Classification)
       │    └→ Task 4 (Capability)
       │         └→ Task 5 (API Routes)
       │              └→ Task 8 (Vault Page UI)
       │                   └→ Task 9 (Sensitive Reveal)
       ├→ Task 6 (File Upload)
       └→ Task 7 (SuperMemory)
```

Tasks 6 and 7 can be done in parallel after Task 2. Task 8 depends on Tasks 3-7 being complete. Task 9 is verification/polish.

## Notes for Implementation

- **Tailwind CSS v4**: This project uses Tailwind v4. Do NOT use `@tailwindcss/typography` — use custom CSS for markdown rendering.
- **Config key migration**: Adding `capability:vault` to `configKeyEnum` requires `ALTER TYPE config_key ADD VALUE`. Drizzle-kit generate should handle this, but verify the migration SQL.
- **Ollama fallback**: All Ollama-dependent features (classification, summary generation) must have fallbacks for when Ollama is unavailable.
- **gitignore**: Add `data/vault/` to `.gitignore` before storing any files.
- **Auth**: All API routes must check `getSession()` first — follow existing route patterns.
- **Action card conversationId**: The `action_cards.conversationId` is nullable in the schema, so vault cards without a conversation context work fine.
