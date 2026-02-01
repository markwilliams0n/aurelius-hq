# Memory V2 Implementation Plan

**Date:** 2026-02-01
**Status:** Ready to implement
**Prerequisites:** Read `docs/memory-architecture-discussion.md` for context

---

## Overview

Migrate Aurelius from database-based memory (entities/facts tables with tool-calling) to file-based memory with QMD search. This improves reliability (no tool-calling issues) and enables sophisticated local search.

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                   localhost                                  │
├─────────────────────────────────────────────────────────────┤
│  Next.js (localhost:3333)                                    │
│  ├── Web UI (chat, triage, memory browser)                  │
│  └── API routes                                              │
│         ↓                                                    │
│  QMD (shell out)                                             │
│         ↓                                                    │
│  Files: ./life/, ./memory/, ME.md                           │
│                                                              │
│  Postgres (Neon) ← auth, inbox, tasks, conversations        │
└─────────────────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice |
|----------|--------|
| Entity creation | AI writes to daily notes, heartbeat extracts entities |
| QMD integration | Shell out to CLI (local only for now) |
| Reindexing | Heartbeat-based (periodic, every few minutes) |
| Local model | GGUF model for QMD reranking + heartbeat extraction |
| Cloud model | OpenRouter for main chat only |

---

## Phase 1: File Structure & QMD Setup

**Goal:** Create the file-based memory structure and verify QMD works.

### Task 1.1: Create Directory Structure

Create the following in project root:

```
aurelius-hq/
├── life/
│   ├── projects/
│   │   └── _index.md
│   ├── areas/
│   │   ├── people/
│   │   │   └── _index.md
│   │   ├── companies/
│   │   │   └── _index.md
│   │   └── _index.md
│   ├── resources/
│   │   └── _index.md
│   ├── archives/
│   │   └── _index.md
│   └── _index.md
├── memory/
│   └── .gitkeep
└── ME.md
```

**Files to create:**

`life/_index.md`:
```markdown
# Knowledge Graph

This directory contains structured knowledge organized using the PARA method.

## Structure

- **projects/** - Active work with deadlines
- **areas/** - Ongoing responsibilities (people, companies)
- **resources/** - Reference material
- **archives/** - Inactive items
```

`life/projects/_index.md`:
```markdown
# Projects

Active work with clear goals and deadlines. When complete, move to archives.
```

`life/areas/_index.md`:
```markdown
# Areas

Ongoing responsibilities with no end date.

## Subdirectories

- **people/** - People I know and interact with
- **companies/** - Companies and organizations
```

`life/areas/people/_index.md`:
```markdown
# People

People I know, work with, or interact with regularly.
```

`life/areas/companies/_index.md`:
```markdown
# Companies

Companies and organizations I work with or am aware of.
```

`life/resources/_index.md`:
```markdown
# Resources

Reference material and topics of interest.
```

`life/archives/_index.md`:
```markdown
# Archives

Inactive items from projects, areas, or resources.
```

`ME.md`:
```markdown
# About Me

This file contains tacit knowledge - patterns, preferences, and working style.

## Communication Preferences

(To be learned over time)

## Working Style

(To be learned over time)

## Tools & Workflows

(To be learned over time)

## Rules & Boundaries

(To be learned over time)
```

`memory/.gitkeep`:
```
# Daily notes directory - files created automatically as memory/YYYY-MM-DD.md
```

**Acceptance criteria:**
- [ ] All directories exist
- [ ] All _index.md files created
- [ ] ME.md exists at project root
- [ ] memory/ directory exists

---

### Task 1.2: Install QMD

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install QMD globally
bun install -g github:tobi/qmd

# Verify installation
qmd --help
```

**Acceptance criteria:**
- [ ] `qmd --help` runs without error

---

### Task 1.3: Configure QMD Collections

```bash
# From project root
cd /Users/markwilliamson/Claude\ Code/aurelius-hq

# Add knowledge graph collection
qmd collection add ./life --name life --mask "**/*.md"

# Add daily notes collection
qmd collection add ./memory --name memory --mask "**/*.md"

# Add tacit knowledge
qmd collection add . --name me --mask "ME.md"

# Initial index
qmd update

# Generate embeddings (requires GGUF model)
qmd embed
```

**Note:** QMD will prompt for GGUF model setup on first embed. Use a small model like Phi-3 or Llama 3.2 3B.

**Acceptance criteria:**
- [ ] `qmd collection list` shows three collections
- [ ] `qmd update` completes without error
- [ ] `qmd embed` completes (may take a few minutes first time)

---

### Task 1.4: Test QMD Search

Create a test file and verify search works:

```bash
# Create a test entity
mkdir -p life/areas/people/test-person
cat > life/areas/people/test-person/summary.md << 'EOF'
# Test Person

A test entity to verify QMD search is working.

## Summary

Test Person works at Example Corp as a software engineer.
They live in San Francisco and enjoy hiking.
EOF

# Reindex
qmd update
qmd embed

# Test searches
qmd search "Test Person" -c life
qmd vsearch "software engineer San Francisco" -c life
qmd query "who works at Example Corp"
```

**Acceptance criteria:**
- [ ] All three search types return the test file
- [ ] Delete test file after verification

---

## Phase 2: AI File Writing

**Goal:** AI writes to daily notes instead of calling remember() tool.

### Task 2.1: Create Daily Note Utilities

Create `src/lib/memory/daily-notes.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'memory');

function getTodayFilename(): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${today}.md`;
}

function getTodayPath(): string {
  return path.join(MEMORY_DIR, getTodayFilename());
}

export async function ensureMemoryDir(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

export async function appendToDailyNote(content: string): Promise<void> {
  await ensureMemoryDir();
  const filepath = getTodayPath();

  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const entry = `\n## ${timestamp}\n\n${content}\n`;

  // Check if file exists
  try {
    await fs.access(filepath);
    // Append to existing file
    await fs.appendFile(filepath, entry);
  } catch {
    // Create new file with header
    const header = `# ${new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}\n`;
    await fs.writeFile(filepath, header + entry);
  }
}

export async function readDailyNote(date?: string): Promise<string | null> {
  const filename = date ? `${date}.md` : getTodayFilename();
  const filepath = path.join(MEMORY_DIR, filename);

  try {
    return await fs.readFile(filepath, 'utf-8');
  } catch {
    return null;
  }
}

export async function listDailyNotes(): Promise<string[]> {
  await ensureMemoryDir();
  const files = await fs.readdir(MEMORY_DIR);
  return files
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse();
}
```

**Acceptance criteria:**
- [ ] File created at correct path
- [ ] `appendToDailyNote()` creates file with date header if new
- [ ] `appendToDailyNote()` appends with timestamp if existing
- [ ] `readDailyNote()` returns content or null
- [ ] `listDailyNotes()` returns sorted list

---

### Task 2.2: Create QMD Search Utility

Create `src/lib/memory/search.ts`:

```typescript
import { execSync } from 'child_process';

export interface SearchResult {
  path: string;
  content: string;
  score: number;
  collection: string;
}

export interface SearchOptions {
  collection?: 'life' | 'memory' | 'me' | 'all';
  limit?: number;
  format?: 'json' | 'markdown';
}

export function searchMemory(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const {
    collection = 'all',
    limit = 10,
    format = 'json'
  } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const cmd = `qmd query "${query.replace(/"/g, '\\"')}" ${collectionFlag} --limit ${limit} --format ${format}`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000 // 30 second timeout
    });

    if (format === 'json') {
      return JSON.parse(result);
    }

    // Parse markdown format if needed
    return [{ path: '', content: result, score: 1, collection }];
  } catch (error) {
    console.error('QMD search error:', error);
    return [];
  }
}

export function keywordSearch(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { collection = 'all', limit = 10 } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const cmd = `qmd search "${query.replace(/"/g, '\\"')}" ${collectionFlag} --limit ${limit} --format json`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 10000
    });

    return JSON.parse(result);
  } catch (error) {
    console.error('QMD keyword search error:', error);
    return [];
  }
}

export function semanticSearch(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { collection = 'all', limit = 10 } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const cmd = `qmd vsearch "${query.replace(/"/g, '\\"')}" ${collectionFlag} --limit ${limit} --format json`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000
    });

    return JSON.parse(result);
  } catch (error) {
    console.error('QMD semantic search error:', error);
    return [];
  }
}
```

**Acceptance criteria:**
- [ ] `searchMemory()` calls QMD query command
- [ ] `keywordSearch()` calls QMD search command
- [ ] `semanticSearch()` calls QMD vsearch command
- [ ] All handle errors gracefully

---

### Task 2.3: Update System Prompt

Update `src/lib/ai/prompts.ts` to remove remember() tool instructions and add file-writing instructions:

```typescript
export function getChatSystemPrompt(modelId: string) {
  return `You are Aurelius, a personal AI assistant with persistent memory. You help the user manage their communications, tasks, and knowledge.

Your personality:
- Thoughtful and direct
- Stoic yet warm
- Concise but thorough when needed

## Technical Details
You are powered by ${modelId}. When asked about your model, be honest and direct about this.

## Memory System

You have access to a file-based memory system. Your knowledge is stored in markdown files.

### Reading Memory
Before responding to questions about people, projects, or past conversations, I will search your memory and provide relevant context. You don't need to do anything special - context will be injected automatically.

### Writing Memory
During our conversation, important information will be recorded to daily notes automatically. This includes:
- New people mentioned and their context
- Projects and their details
- Preferences and decisions
- Significant events and milestones

You don't need to explicitly "remember" things - just have natural conversations and the system handles persistence.

### What Gets Remembered
- People: names, roles, relationships, locations
- Projects: what they are, status, who's involved
- Companies: what they do, who works there
- Preferences: how the user likes things done
- Context: important background information

Focus on having helpful conversations. Memory is handled behind the scenes.
`;
}
```

**Acceptance criteria:**
- [ ] System prompt updated
- [ ] No mention of remember() tool
- [ ] Explains file-based memory at high level

---

### Task 2.4: Create Memory Extraction Service

The AI response needs to be analyzed to extract memories. Create `src/lib/memory/extraction.ts`:

```typescript
import { appendToDailyNote } from './daily-notes';

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Extract and save noteworthy information from a conversation turn.
 * This runs after the AI responds, analyzing what was discussed.
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  // For now, just save the conversation exchange to daily notes
  // Later: use local LLM to extract structured facts

  const entry = formatConversationEntry(userMessage, assistantResponse);
  await appendToDailyNote(entry);
}

function formatConversationEntry(
  userMessage: string,
  assistantResponse: string
): string {
  // Truncate very long messages
  const maxLength = 500;
  const truncatedUser = userMessage.length > maxLength
    ? userMessage.slice(0, maxLength) + '...'
    : userMessage;
  const truncatedAssistant = assistantResponse.length > maxLength
    ? assistantResponse.slice(0, maxLength) + '...'
    : assistantResponse;

  return `**User:** ${truncatedUser}

**Aurelius:** ${truncatedAssistant}`;
}

/**
 * Check if a message contains information worth persisting.
 * Used to avoid logging purely transactional exchanges.
 */
export function containsMemorableContent(message: string): boolean {
  // Simple heuristics - can be enhanced later
  const patterns = [
    /\b(?:my|i|we|our)\b.*\b(?:friend|colleague|boss|partner|wife|husband)\b/i,
    /\b(?:works?|working)\s+(?:at|for|on)\b/i,
    /\b(?:lives?|living)\s+in\b/i,
    /\b(?:project|company|team)\b/i,
    /\b(?:prefer|like|want|need|always|never)\b/i,
    /\b(?:remember|don't forget|note that)\b/i,
  ];

  return patterns.some(p => p.test(message));
}
```

**Acceptance criteria:**
- [ ] `extractAndSaveMemories()` writes to daily notes
- [ ] Conversation format is readable
- [ ] Long messages are truncated
- [ ] `containsMemorableContent()` detects notable patterns

---

### Task 2.5: Update Chat Route

Update `src/app/api/chat/route.ts` to:
1. Search memory for context before responding
2. Save conversation to daily notes after responding
3. Remove remember() tool

```typescript
// Key changes to chat route:

import { searchMemory } from '@/lib/memory/search';
import { extractAndSaveMemories, containsMemorableContent } from '@/lib/memory/extraction';

// Before calling AI, search for relevant context
const memoryContext = await getMemoryContext(userMessage);

// In buildChatPrompt, include memory context
const prompt = buildChatPrompt(memoryContext, soulConfig, modelId);

// After AI responds, save to daily notes
if (containsMemorableContent(userMessage)) {
  await extractAndSaveMemories(userMessage, assistantResponse);
}

// Helper to search memory
async function getMemoryContext(query: string): Promise<string | null> {
  const results = searchMemory(query, { limit: 5 });

  if (results.length === 0) return null;

  return results
    .map(r => `[${r.path}]\n${r.content}`)
    .join('\n\n---\n\n');
}
```

**Acceptance criteria:**
- [ ] Chat searches memory before responding
- [ ] Memory context injected into prompt
- [ ] Conversations saved to daily notes
- [ ] remember() tool removed
- [ ] Streaming still works

---

### Task 2.6: Remove Old Memory Tools

- [ ] Delete or deprecate `src/lib/ai/tools.ts` (remember tool)
- [ ] Remove tool imports from chat route
- [ ] Update any tests

**Note:** Keep the database tables for now (entities, facts) - we may want to migrate existing data or keep as backup. Just stop writing to them.

---

## Phase 3: Entity Management

**Goal:** Heartbeat process extracts entities from daily notes.

### Task 3.1: Create Entity File Utilities

Create `src/lib/memory/entities.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');

export type EntityType = 'person' | 'company' | 'project' | 'resource';

export interface EntityFact {
  id: string;
  fact: string;
  category: 'relationship' | 'milestone' | 'status' | 'preference' | 'context';
  timestamp: string;
  source: string;
  status: 'active' | 'superseded';
  supersededBy: string | null;
  relatedEntities: string[];
  lastAccessed: string;
  accessCount: number;
}

export interface EntityData {
  name: string;
  type: EntityType;
  summary: string;
  facts: EntityFact[];
}

function getEntityPath(type: EntityType, slug: string): string {
  const typeDir = type === 'person' ? 'areas/people'
    : type === 'company' ? 'areas/companies'
    : type === 'project' ? 'projects'
    : 'resources';

  return path.join(LIFE_DIR, typeDir, slug);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function entityExists(type: EntityType, name: string): Promise<boolean> {
  const entityPath = getEntityPath(type, slugify(name));
  try {
    await fs.access(entityPath);
    return true;
  } catch {
    return false;
  }
}

export async function createEntity(
  type: EntityType,
  name: string,
  summary: string,
  initialFacts: Omit<EntityFact, 'id' | 'lastAccessed' | 'accessCount'>[] = []
): Promise<void> {
  const slug = slugify(name);
  const entityPath = getEntityPath(type, slug);

  // Create directory
  await fs.mkdir(entityPath, { recursive: true });

  // Create summary.md
  const summaryContent = `# ${name}

**Type:** ${type}
**Created:** ${new Date().toISOString().split('T')[0]}

## Summary

${summary}
`;
  await fs.writeFile(path.join(entityPath, 'summary.md'), summaryContent);

  // Create items.json
  const facts: EntityFact[] = initialFacts.map((f, i) => ({
    ...f,
    id: `${slug}-${Date.now()}-${i}`,
    lastAccessed: new Date().toISOString(),
    accessCount: 0
  }));

  await fs.writeFile(
    path.join(entityPath, 'items.json'),
    JSON.stringify(facts, null, 2)
  );
}

export async function addFactToEntity(
  type: EntityType,
  name: string,
  fact: Omit<EntityFact, 'id' | 'lastAccessed' | 'accessCount'>
): Promise<void> {
  const slug = slugify(name);
  const entityPath = getEntityPath(type, slug);
  const itemsPath = path.join(entityPath, 'items.json');

  // Read existing facts
  let facts: EntityFact[] = [];
  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    facts = JSON.parse(content);
  } catch {
    // File doesn't exist, start fresh
  }

  // Add new fact
  const newFact: EntityFact = {
    ...fact,
    id: `${slug}-${Date.now()}`,
    lastAccessed: new Date().toISOString(),
    accessCount: 0
  };

  facts.push(newFact);

  await fs.writeFile(itemsPath, JSON.stringify(facts, null, 2));
}

export async function readEntity(type: EntityType, name: string): Promise<EntityData | null> {
  const slug = slugify(name);
  const entityPath = getEntityPath(type, slug);

  try {
    const summaryContent = await fs.readFile(
      path.join(entityPath, 'summary.md'),
      'utf-8'
    );

    let facts: EntityFact[] = [];
    try {
      const itemsContent = await fs.readFile(
        path.join(entityPath, 'items.json'),
        'utf-8'
      );
      facts = JSON.parse(itemsContent);
    } catch {
      // No facts yet
    }

    // Extract summary from markdown (between ## Summary and next ##)
    const summaryMatch = summaryContent.match(/## Summary\n\n([\s\S]*?)(?=\n##|$)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';

    return { name, type, summary, facts };
  } catch {
    return null;
  }
}

export async function listEntities(type?: EntityType): Promise<string[]> {
  const types: EntityType[] = type ? [type] : ['person', 'company', 'project', 'resource'];
  const entities: string[] = [];

  for (const t of types) {
    const typeDir = t === 'person' ? 'areas/people'
      : t === 'company' ? 'areas/companies'
      : t === 'project' ? 'projects'
      : 'resources';

    const dirPath = path.join(LIFE_DIR, typeDir);

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('_')) {
          entities.push(`${typeDir}/${item.name}`);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return entities;
}
```

**Acceptance criteria:**
- [ ] Can create entities with summary.md + items.json
- [ ] Can add facts to existing entities
- [ ] Can read entity data
- [ ] Can list all entities

---

### Task 3.2: Create Heartbeat Extraction Process

Create `src/lib/memory/heartbeat.ts`:

```typescript
import { execSync } from 'child_process';
import { listDailyNotes, readDailyNote } from './daily-notes';
import { createEntity, addFactToEntity, entityExists } from './entities';

interface ExtractedEntity {
  name: string;
  type: 'person' | 'company' | 'project';
  facts: string[];
}

/**
 * Run the heartbeat process:
 * 1. Scan recent daily notes
 * 2. Extract entities and facts (using local LLM)
 * 3. Create/update entity files
 * 4. Reindex QMD
 */
export async function runHeartbeat(): Promise<void> {
  console.log('[Heartbeat] Starting...');

  // 1. Get recent daily notes (last 3 days)
  const notes = await listDailyNotes();
  const recentNotes = notes.slice(0, 3);

  for (const noteFile of recentNotes) {
    const date = noteFile.replace('.md', '');
    const content = await readDailyNote(date);
    if (!content) continue;

    // 2. Extract entities (placeholder - implement with local LLM)
    const extracted = await extractEntitiesFromNote(content, date);

    // 3. Create/update entity files
    for (const entity of extracted) {
      const exists = await entityExists(entity.type, entity.name);

      if (!exists) {
        await createEntity(
          entity.type,
          entity.name,
          `Extracted from daily notes on ${date}`,
          entity.facts.map(f => ({
            fact: f,
            category: 'context' as const,
            timestamp: date,
            source: date,
            status: 'active' as const,
            supersededBy: null,
            relatedEntities: []
          }))
        );
        console.log(`[Heartbeat] Created entity: ${entity.name}`);
      } else {
        // Add new facts to existing entity
        for (const fact of entity.facts) {
          await addFactToEntity(entity.type, entity.name, {
            fact,
            category: 'context',
            timestamp: date,
            source: date,
            status: 'active',
            supersededBy: null,
            relatedEntities: []
          });
        }
        console.log(`[Heartbeat] Updated entity: ${entity.name}`);
      }
    }
  }

  // 4. Reindex QMD
  await reindexQMD();

  console.log('[Heartbeat] Complete');
}

/**
 * Extract entities from a daily note.
 * TODO: Implement with local LLM (Ollama/node-llama-cpp)
 */
async function extractEntitiesFromNote(
  content: string,
  date: string
): Promise<ExtractedEntity[]> {
  // Placeholder implementation using regex patterns
  // Replace with local LLM call later

  const entities: ExtractedEntity[] = [];

  // Simple pattern matching for people
  const personPatterns = [
    /(?:my (?:friend|colleague|boss|partner|wife|husband|brother|sister|mom|dad|mother|father))\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:works at|lives in|is a|told me)/g,
  ];

  for (const pattern of personPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name.length > 2 && !entities.find(e => e.name === name)) {
        entities.push({
          name,
          type: 'person',
          facts: [`Mentioned on ${date}`]
        });
      }
    }
  }

  return entities;
}

/**
 * Reindex QMD collections
 */
async function reindexQMD(): Promise<void> {
  try {
    execSync('qmd update', {
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: 60000
    });
    console.log('[Heartbeat] QMD reindexed');
  } catch (error) {
    console.error('[Heartbeat] QMD reindex failed:', error);
  }
}
```

**Acceptance criteria:**
- [ ] Heartbeat scans recent daily notes
- [ ] Basic entity extraction works (regex for now)
- [ ] Creates new entity files
- [ ] Updates existing entities
- [ ] Reindexes QMD

---

### Task 3.3: Create Heartbeat API Endpoint

Create `src/app/api/heartbeat/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { runHeartbeat } from '@/lib/memory/heartbeat';

export async function POST() {
  try {
    await runHeartbeat();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: 'Heartbeat failed' },
      { status: 500 }
    );
  }
}
```

**Acceptance criteria:**
- [ ] POST /api/heartbeat triggers heartbeat
- [ ] Returns success/error appropriately

---

### Task 3.4: Create Heartbeat Scheduler

For local dev, use a simple interval. Create `src/lib/memory/scheduler.ts`:

```typescript
import { runHeartbeat } from './heartbeat';

let intervalId: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function startHeartbeatScheduler(): void {
  if (intervalId) {
    console.log('[Scheduler] Already running');
    return;
  }

  console.log(`[Scheduler] Starting heartbeat every ${HEARTBEAT_INTERVAL / 1000}s`);

  intervalId = setInterval(async () => {
    try {
      await runHeartbeat();
    } catch (error) {
      console.error('[Scheduler] Heartbeat error:', error);
    }
  }, HEARTBEAT_INTERVAL);
}

export function stopHeartbeatScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] Stopped');
  }
}
```

**Integration:** Start scheduler in Next.js instrumentation or a separate worker process.

**Acceptance criteria:**
- [ ] Scheduler runs heartbeat on interval
- [ ] Can start/stop scheduler

---

## Phase 4: Memory Browser UI

**Goal:** Update /memory page to read from files instead of database.

### Task 4.1: Create Memory API Endpoints

Create `src/app/api/memory/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { listEntities } from '@/lib/memory/entities';
import { listDailyNotes } from '@/lib/memory/daily-notes';

export async function GET() {
  const [entities, dailyNotes] = await Promise.all([
    listEntities(),
    listDailyNotes()
  ]);

  return NextResponse.json({
    entities,
    dailyNotes,
    counts: {
      people: entities.filter(e => e.includes('people/')).length,
      companies: entities.filter(e => e.includes('companies/')).length,
      projects: entities.filter(e => e.includes('projects/')).length,
      resources: entities.filter(e => e.includes('resources/')).length,
      dailyNotes: dailyNotes.length
    }
  });
}
```

Create `src/app/api/memory/[...path]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const filePath = params.path.join('/');
  const fullPath = path.join(process.cwd(), 'life', filePath);

  try {
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      // Return directory contents
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      return NextResponse.json({
        type: 'directory',
        items: items.map(i => ({
          name: i.name,
          isDirectory: i.isDirectory()
        }))
      });
    } else {
      // Return file contents
      const content = await fs.readFile(fullPath, 'utf-8');
      const isJson = fullPath.endsWith('.json');

      return NextResponse.json({
        type: 'file',
        content: isJson ? JSON.parse(content) : content
      });
    }
  } catch {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    );
  }
}
```

**Acceptance criteria:**
- [ ] GET /api/memory returns overview
- [ ] GET /api/memory/areas/people lists people
- [ ] GET /api/memory/areas/people/joe-bloggs/summary.md returns content

---

### Task 4.2: Update Memory Browser Page

Update `src/app/(app)/memory/page.tsx` to use file-based API:

- [ ] Fetch from /api/memory instead of database
- [ ] Show PARA structure (projects, areas, resources, archives)
- [ ] Navigate into directories
- [ ] View entity summary.md and items.json
- [ ] Show daily notes timeline
- [ ] Search using QMD (via new search endpoint)

**Acceptance criteria:**
- [ ] Page loads without database queries
- [ ] Can browse PARA structure
- [ ] Can view entity details
- [ ] Can view daily notes

---

### Task 4.3: Create Search Endpoint

Create `src/app/api/memory/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { searchMemory } from '@/lib/memory/search';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const results = searchMemory(query, { limit: 20 });

  return NextResponse.json({ results });
}
```

**Acceptance criteria:**
- [ ] GET /api/memory/search?q=test returns results
- [ ] Uses QMD for search

---

## Phase 5: Intelligence (Heartbeat Enhancements)

**Goal:** Add sophisticated extraction, memory decay, and weekly synthesis.

### Task 5.1: Integrate Local LLM for Extraction

Replace regex-based extraction with local LLM:

- [ ] Set up Ollama or node-llama-cpp
- [ ] Create extraction prompt
- [ ] Parse LLM response into structured entities
- [ ] Handle extraction errors gracefully

---

### Task 5.2: Implement Access Tracking

- [ ] Update `lastAccessed` when entity is retrieved for context
- [ ] Increment `accessCount` on each access
- [ ] Track in items.json

---

### Task 5.3: Implement Memory Decay

During weekly synthesis:

- [ ] Load all entity facts
- [ ] Categorize by tier:
  - Hot: accessed in last 7 days
  - Warm: accessed 8-30 days ago
  - Cold: 30+ days without access
- [ ] High accessCount resists decay
- [ ] Regenerate summary.md with only hot/warm facts

---

### Task 5.4: Weekly Synthesis Process

Create scheduled job for weekly synthesis:

- [ ] Run every Sunday at midnight
- [ ] For each entity:
  - [ ] Apply decay tiers
  - [ ] Regenerate summary.md from active facts
  - [ ] Archive cold facts (keep in items.json, exclude from summary)
- [ ] Reindex QMD after synthesis

---

## Testing Checklist

### Phase 1
- [ ] QMD installed and working
- [ ] Collections configured
- [ ] Search returns results

### Phase 2
- [ ] Chat writes to daily notes
- [ ] Memory context injected into AI
- [ ] Conversations persisted

### Phase 3
- [ ] Heartbeat extracts entities
- [ ] Entity files created correctly
- [ ] QMD reindexes after heartbeat

### Phase 4
- [ ] Memory browser shows file-based data
- [ ] Can navigate PARA structure
- [ ] Search works in UI

### Phase 5
- [ ] Local LLM extraction working
- [ ] Access tracking updates
- [ ] Memory decay applied weekly

---

## Migration Notes

### Database Tables to Deprecate

After file-based memory is working:

- `entities` - replaced by life/**/summary.md
- `facts` - replaced by life/**/items.json
- `documents` - optionally keep for ingested documents
- `document_chunks` - optionally keep for document search

### Tables to Keep

- `users`, `sessions`, `magic_links` - auth
- `configs` - soul, agents, processes
- `activity_log` - audit trail
- `conversations` - chat history
- `inbox_items`, `tasks`, `connectors`, `triage_rules` - triage system (Phase 4 of main roadmap)

---

## Open Items

- [ ] How to handle existing entities/facts in database? Migrate or start fresh?
- [ ] GGUF model selection for local LLM
- [ ] QMD MCP integration for potential Claude Code usage
- [ ] Remote access strategy (Tailscale, etc.) - deferred
