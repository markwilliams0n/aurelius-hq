# Aurelius Can Code — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `code` capability so Aurelius can spawn Claude Code CLI sessions to work on its own codebase, with action card approval before starting and before merging.

**Architecture:** The `code` capability follows the existing capability pattern (`src/lib/capabilities/<name>/index.ts`). When the agent calls `start_coding_session`, it returns an action card. On approval, the handler creates a git worktree, spawns `claude -p` with NDJSON streaming, parses progress events, and on completion presents a result card with diff stats for approve/reject/merge.

**Tech Stack:** Next.js 16, TypeScript, child_process (spawn), git worktrees, Claude Code CLI (`claude -p --output-format stream-json`), existing action card system, existing capability system.

---

### Task 1: DB Migration — Add enum values

**Files:**
- Create: `src/lib/db/migrations/add-code-enums.sql`
- Modify: `src/lib/db/schema/config.ts:11` (configKeyEnum)
- Modify: `src/lib/db/schema/action-cards.ts:13` (cardPatternEnum)

**Step 1: Write the migration SQL**

Create `src/lib/db/migrations/add-code-enums.sql`:

```sql
-- Add 'capability:code' to config_key enum
ALTER TYPE config_key ADD VALUE IF NOT EXISTS 'capability:code';

-- Add 'code' to card_pattern enum
ALTER TYPE card_pattern ADD VALUE IF NOT EXISTS 'code';
```

**Step 2: Run the migration against Neon**

Run: `psql "$DATABASE_URL" -f src/lib/db/migrations/add-code-enums.sql`
Expected: Two `ALTER TYPE` statements succeed.

**Step 3: Update Drizzle schema — configKeyEnum**

In `src/lib/db/schema/config.ts:11`, add `"capability:code"` to the `configKeyEnum` array:

```typescript
export const configKeyEnum = pgEnum("config_key", ["soul", "system_prompt", "agents", "processes", "capability:tasks", "capability:config", "prompt:email_draft", "capability:slack", "slack:directory", "capability:vault", "capability:code"]);
```

**Step 4: Update Drizzle schema — cardPatternEnum**

In `src/lib/db/schema/action-cards.ts:13`, add `"code"` to the `cardPatternEnum` array:

```typescript
export const cardPatternEnum = pgEnum("card_pattern", [
  "approval",
  "config",
  "confirmation",
  "info",
  "vault",
  "code",
]);
```

**Step 5: Regenerate Drizzle types**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx drizzle-kit generate`
Expected: Generates updated types reflecting the new enum values.

**Step 6: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 7: Commit**

```bash
git add src/lib/db/migrations/add-code-enums.sql src/lib/db/schema/config.ts src/lib/db/schema/action-cards.ts
git commit -m "feat(code): add capability:code and code card_pattern enum values (PER-213)"
```

---

### Task 2: Worktree Management Module

**Files:**
- Create: `src/lib/capabilities/code/worktree.ts`

**Step 1: Create the worktree module**

Create `src/lib/capabilities/code/worktree.ts` with these functions:

```typescript
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const REPO_ROOT = process.cwd();
const WORKTREE_BASE = path.resolve(REPO_ROOT, '..', 'aurelius-worktrees');

export interface WorktreeInfo {
  path: string;
  branchName: string;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  summary: string;
}

/**
 * Create a git worktree on a new branch from main.
 * The worktree lives outside the project dir at ../aurelius-worktrees/<sessionId>
 */
export function createWorktree(branchName: string, sessionId: string): WorktreeInfo {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);

  fs.mkdirSync(WORKTREE_BASE, { recursive: true });

  const result = spawnSync('git', [
    'worktree', 'add',
    '-b', branchName,
    worktreePath,
    'main',
  ], { cwd: REPO_ROOT, stdio: 'pipe' });

  if (result.status !== 0) {
    throw new Error(`Failed to create worktree: ${result.stderr?.toString()}`);
  }

  return { path: worktreePath, branchName };
}

/**
 * Get diff stats between worktree branch and main.
 */
export function getWorktreeDiff(worktreePath: string): string {
  const result = spawnSync('git', ['diff', 'main...HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
    maxBuffer: 500 * 1024,
  });
  return result.stdout?.toString() || '';
}

/**
 * Get summary stats (files changed, insertions, deletions).
 */
export function getWorktreeStats(worktreePath: string): DiffStats {
  const result = spawnSync('git', ['diff', '--stat', 'main...HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  const output = result.stdout?.toString().trim() || '';
  const lines = output.split('\n');
  const summaryLine = lines[lines.length - 1] || '';

  const filesMatch = summaryLine.match(/(\d+) files? changed/);
  const insMatch = summaryLine.match(/(\d+) insertions?\(\+\)/);
  const delMatch = summaryLine.match(/(\d+) deletions?\(-\)/);

  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
    insertions: insMatch ? parseInt(insMatch[1]) : 0,
    deletions: delMatch ? parseInt(delMatch[1]) : 0,
    summary: summaryLine,
  };
}

/**
 * Get the list of files changed in the worktree vs main.
 */
export function getChangedFiles(worktreePath: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', 'main...HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  return (result.stdout?.toString().trim() || '')
    .split('\n')
    .filter(Boolean);
}

/**
 * Get commit log on worktree branch since diverging from main.
 */
export function getWorktreeLog(worktreePath: string): string {
  const result = spawnSync('git', ['log', '--oneline', 'main..HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  return result.stdout?.toString().trim() || '';
}

/**
 * Fast-forward merge the worktree branch into main, then cleanup.
 */
export function mergeWorktree(worktreePath: string, branchName: string): void {
  const mergeResult = spawnSync('git', ['merge', '--ff-only', branchName], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  if (mergeResult.status !== 0) {
    throw new Error(
      `Fast-forward merge failed. Main may have moved since the session started. ` +
      `Error: ${mergeResult.stderr?.toString()}`
    );
  }

  cleanupWorktree(worktreePath, branchName);
}

/**
 * Remove worktree and delete its branch.
 */
export function cleanupWorktree(worktreePath: string, branchName: string): void {
  spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  spawnSync('git', ['branch', '-D', branchName], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
}

/**
 * Check if a worktree exists for a session.
 */
export function worktreeExists(sessionId: string): boolean {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);
  return fs.existsSync(worktreePath);
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/lib/capabilities/code/worktree.ts
git commit -m "feat(code): git worktree management — create, diff, merge, cleanup (PER-213)"
```

---

### Task 3: Executor — Spawn and Parse Claude Code

**Files:**
- Create: `src/lib/capabilities/code/executor.ts`

**Step 1: Create the executor module**

Create `src/lib/capabilities/code/executor.ts`:

```typescript
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { Readable } from 'stream';

// --- Types ---

export interface ProgressEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'milestone';
  text?: string;
  tool?: string;
  input?: string;
}

export interface SessionResult {
  sessionId?: string;
  turns: number;
  durationMs: number;
  costUsd: number | null;
}

export interface CodeSessionOptions {
  sessionId: string;
  prompt: string;
  worktreePath: string;
  maxTurns: number;
  timeoutMs: number;
  onProgress: (event: ProgressEvent) => void;
  onComplete: (result: SessionResult) => void;
  onError: (error: Error) => void;
}

export interface ActiveSession {
  pid: number;
  kill: () => void;
  process: ChildProcess;
}

// --- Allowed Tools ---

const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(git:*)',
  'Bash(npx tsc:*)',
  'Bash(npx vitest:*)',
  'Bash(bun add:*)',
  'Bash(bun run:*)',
  'Bash(bun install:*)',
  'Bash(bunx drizzle-kit:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
];

// --- Safe Environment ---

function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    SHELL: process.env.SHELL || '/bin/zsh',
    LANG: process.env.LANG || 'en_US.UTF-8',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // DO NOT include ANTHROPIC_API_KEY — forces Max subscription
  };

  const passthrough = ['NODE_ENV', 'TERM'];
  for (const key of passthrough) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }

  return safe;
}

// --- Tool Input Summarizer ---

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return String(input.file_path || '');
    case 'Edit':
      return String(input.file_path || '');
    case 'Write':
      return String(input.file_path || '');
    case 'Glob':
      return String(input.pattern || '');
    case 'Grep':
      return String(input.pattern || '');
    case 'Bash':
      return String(input.command || '').slice(0, 120);
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

// --- Stream Parser ---

function parseStream(
  stdout: Readable,
  onProgress: (event: ProgressEvent) => void,
  onComplete: (result: SessionResult) => void,
): void {
  const rl = readline.createInterface({ input: stdout });

  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);

      if (event.type === 'assistant') {
        for (const block of event.message?.content || []) {
          if (block.type === 'text' && block.text) {
            onProgress({ type: 'thinking', text: block.text });
          }
          if (block.type === 'tool_use') {
            onProgress({
              type: 'tool_call',
              tool: block.name,
              input: summarizeToolInput(block.name, block.input || {}),
            });
          }
        }
      }

      if (event.type === 'result') {
        onComplete({
          sessionId: event.session_id,
          turns: event.num_turns || 0,
          durationMs: event.duration_ms || 0,
          costUsd: event.total_cost_usd ?? null,
        });
      }
    } catch {
      // Skip malformed JSON lines
    }
  });
}

// --- Session Spawner ---

export function startSession(options: CodeSessionOptions): ActiveSession {
  const args = [
    '-p', options.prompt,
    '--output-format', 'stream-json',
    '--max-turns', String(options.maxTurns),
    '--permission-mode', 'acceptEdits',
    '--no-session-persistence',
  ];

  // Add each allowed tool
  for (const tool of ALLOWED_TOOLS) {
    args.push('--allowedTools', tool);
  }

  const child = spawn('claude', args, {
    cwd: options.worktreePath,
    env: buildSafeEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Set up timeout
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    options.onError(new Error(`Session timed out after ${options.timeoutMs}ms`));
  }, options.timeoutMs);

  // Parse stdout for progress
  if (child.stdout) {
    parseStream(child.stdout, options.onProgress, (result) => {
      clearTimeout(timeout);
      options.onComplete(result);
    });
  }

  // Handle stderr (log but don't fail on it)
  if (child.stderr) {
    const stderrRl = readline.createInterface({ input: child.stderr });
    stderrRl.on('line', (line) => {
      console.log(`[CodeSession ${options.sessionId}] stderr: ${line}`);
    });
  }

  child.on('error', (err) => {
    clearTimeout(timeout);
    options.onError(err);
  });

  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (code !== 0 && code !== null) {
      options.onError(new Error(`claude exited with code ${code}`));
    }
  });

  return {
    pid: child.pid!,
    kill: () => {
      clearTimeout(timeout);
      child.kill('SIGTERM');
    },
    process: child,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/lib/capabilities/code/executor.ts
git commit -m "feat(code): executor — spawn claude -p, parse NDJSON stream (PER-213)"
```

---

### Task 4: Prompt Builder

**Files:**
- Create: `src/lib/capabilities/code/prompts.ts`

**Step 1: Create the prompt module**

Create `src/lib/capabilities/code/prompts.ts`:

```typescript
/**
 * Build the prompt sent to Claude Code for a coding session.
 */
export function buildCodePrompt(task: string, context?: string): string {
  return `
You are working on the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.
The app runs locally on macOS (not Vercel).

## Your Task
${task}

${context ? `## Additional Context\n${context}` : ''}

## Rules
- Make focused changes — don't refactor unrelated code
- Run \`npx tsc --noEmit\` before finishing to verify no type errors
- Run \`npx vitest run\` if you changed code near existing tests
- Write clear git commit messages referencing what you changed and why
- If adding a config key, the enum requires a DB migration (ALTER TYPE ... ADD VALUE)
- Tailwind v4 — @tailwindcss/typography is incompatible, use custom CSS
- Use bun (not npm) for package operations

## Key Paths
- Capabilities: src/lib/capabilities/<name>/index.ts
- DB Schema: src/lib/db/schema/
- API Routes: src/app/api/
- Components: src/components/aurelius/
- Config: src/lib/config.ts (typed configKeyEnum)
`.trim();
}

/**
 * Generate a branch name from a task description.
 */
export function slugifyTask(task: string): string {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/lib/capabilities/code/prompts.ts
git commit -m "feat(code): prompt builder and task slugifier (PER-213)"
```

---

### Task 5: Code Capability Module

**Files:**
- Create: `src/lib/capabilities/code/index.ts`
- Modify: `src/lib/capabilities/index.ts:20-27` (add to ALL_CAPABILITIES)

**Step 1: Create the capability module**

Create `src/lib/capabilities/code/index.ts`:

```typescript
import type { Capability, ToolDefinition, ToolResult } from '../types';
import { nanoid } from 'nanoid';
import { slugifyTask } from './prompts';

const PROMPT = `# Code Execution

You can start coding sessions on the Aurelius HQ codebase using start_coding_session.
Use this when the user asks you to fix bugs, add features, refactor code, run tests,
or do any development work on Aurelius itself. Also use when a Linear issue describes
code work that can be acted on.

## When to use

- User says "fix the TypeScript errors"
- User says "add a loading spinner to the triage page"
- A triaged Linear issue describes a code change
- You notice something in the codebase that could be improved

## How it works

1. You call start_coding_session with a task description
2. An Action Card appears for the user to review and approve
3. On approval, a Claude Code session runs in an isolated git worktree
4. When complete, a result card shows the diff for approve/reject
5. On approve, changes are merged to main

## Guidelines

- Be specific in the task description — include file paths, error messages, context
- One focused task per session (don't combine unrelated changes)
- Include relevant Linear issue IDs in the context field`;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'start_coding_session',
    description:
      'Start a Claude Code session to work on the Aurelius HQ codebase. ' +
      'Use when the user asks to fix bugs, add features, refactor code, or do development work. ' +
      'Returns an action card for user approval before the session starts.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Clear description of what to build, fix, or change',
        },
        context: {
          type: 'string',
          description: 'Relevant file paths, error messages, Linear issue details',
        },
        branch_name: {
          type: 'string',
          description:
            'Suggested branch name (e.g., "fix-ts-errors"). Auto-generated if omitted.',
        },
      },
      required: ['task'],
    },
  },
];

async function handleCodeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (toolName !== 'start_coding_session') return null;

  const task = String(toolInput.task || '');
  const context = toolInput.context ? String(toolInput.context) : undefined;
  const branchName = toolInput.branch_name
    ? String(toolInput.branch_name)
    : slugifyTask(task);

  if (!task) {
    return { result: JSON.stringify({ error: '"task" is required' }) };
  }

  const sessionId = nanoid(12);
  const fullBranchName = `aurelius/${branchName}`;

  return {
    result: JSON.stringify({
      action_card: {
        pattern: 'code',
        handler: 'code:start',
        title: `Coding: ${task.length > 60 ? task.slice(0, 57) + '...' : task}`,
        data: {
          sessionId,
          task,
          context: context || null,
          branchName: fullBranchName,
          maxTurns: 25,
          timeoutMs: 300_000,
        },
      },
      summary: `Prepared coding session: ${task.length > 80 ? task.slice(0, 77) + '...' : task}`,
    }),
  };
}

export const codeCapability: Capability = {
  name: 'code',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleCodeTool,
};
```

**Step 2: Register the capability**

In `src/lib/capabilities/index.ts`, add the import and register:

Add import at line 20 (after vault import):
```typescript
import { codeCapability } from './code';
```

Add to ALL_CAPABILITIES array:
```typescript
const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
  slackCapability,
  vaultCapability,
  codeCapability,
];
```

**Step 3: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/lib/capabilities/code/index.ts src/lib/capabilities/index.ts
git commit -m "feat(code): capability module — start_coding_session tool (PER-213)"
```

---

### Task 6: Action Card Handlers

**Files:**
- Create: `src/lib/action-cards/handlers/code.ts`
- Modify: `src/app/api/action-card/[id]/route.ts:11` (add handler import)

**Step 1: Create the code handlers**

Create `src/lib/action-cards/handlers/code.ts`:

```typescript
import { registerCardHandler } from "../registry";
import { createWorktree, cleanupWorktree, mergeWorktree, getWorktreeStats, getChangedFiles, getWorktreeLog } from "@/lib/capabilities/code/worktree";
import { startSession, type ActiveSession } from "@/lib/capabilities/code/executor";
import { buildCodePrompt } from "@/lib/capabilities/code/prompts";
import { updateCard } from "../db";

// Track active sessions for kill switch
const activeSessions = new Map<string, ActiveSession>();

// Maximum 1 concurrent session (v1)
function hasActiveSession(): boolean {
  return activeSessions.size > 0;
}

registerCardHandler("code:start", {
  label: "Start Session",
  successMessage: "Coding session started",

  async execute(data) {
    if (hasActiveSession()) {
      return { status: "error", error: "A coding session is already running. Wait for it to finish or stop it first." };
    }

    const sessionId = data.sessionId as string;
    const task = data.task as string;
    const context = data.context as string | null;
    const branchName = data.branchName as string;
    const maxTurns = (data.maxTurns as number) || 25;
    const timeoutMs = (data.timeoutMs as number) || 300_000;
    const cardId = data._cardId as string | undefined;

    if (!sessionId || !task || !branchName) {
      return { status: "error", error: "Missing required session data" };
    }

    // Create worktree
    let worktreePath: string;
    try {
      const wt = createWorktree(branchName, sessionId);
      worktreePath = wt.path;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: `Failed to create worktree: ${msg}` };
    }

    // Build prompt
    const prompt = buildCodePrompt(task, context || undefined);

    // Start session (non-blocking — runs in background)
    const session = startSession({
      sessionId,
      prompt,
      worktreePath,
      maxTurns,
      timeoutMs,
      onProgress: (event) => {
        // For v1, just log progress. Future: emit to chat via SSE.
        console.log(`[CodeSession ${sessionId}] ${event.type}: ${event.text || event.tool || ''}`);
      },
      onComplete: async (result) => {
        activeSessions.delete(sessionId);
        console.log(`[CodeSession ${sessionId}] Complete: ${result.turns} turns, ${result.durationMs}ms`);

        // Gather diff stats
        const stats = getWorktreeStats(worktreePath);
        const changedFiles = getChangedFiles(worktreePath);
        const log = getWorktreeLog(worktreePath);

        // Update the card with result data so the UI can show approve/reject
        if (cardId) {
          try {
            await updateCard(cardId, {
              data: {
                ...data,
                status: 'completed',
                worktreePath,
                result: {
                  turns: result.turns,
                  durationMs: result.durationMs,
                  costUsd: result.costUsd,
                  stats,
                  changedFiles,
                  log,
                },
              },
            });
          } catch (err) {
            console.error(`[CodeSession ${sessionId}] Failed to update card:`, err);
          }
        }
      },
      onError: async (error) => {
        activeSessions.delete(sessionId);
        console.error(`[CodeSession ${sessionId}] Error:`, error.message);

        // Clean up worktree on error
        try {
          cleanupWorktree(worktreePath, branchName);
        } catch {
          // Best effort cleanup
        }

        if (cardId) {
          try {
            await updateCard(cardId, {
              status: 'error',
              result: { error: error.message },
            });
          } catch (err) {
            console.error(`[CodeSession ${sessionId}] Failed to update card:`, err);
          }
        }
      },
    });

    activeSessions.set(sessionId, session);

    return { status: "confirmed" };
  },
});

registerCardHandler("code:approve", {
  label: "Approve & Merge",
  successMessage: "Changes merged to main!",
  confirmMessage: "Merge these changes into main?",

  async execute(data) {
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktree data" };
    }

    try {
      mergeWorktree(worktreePath, branchName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", error: msg };
    }

    return { status: "confirmed" };
  },
});

registerCardHandler("code:reject", {
  label: "Reject",
  successMessage: "Changes discarded",

  async execute(data) {
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;

    if (!worktreePath || !branchName) {
      return { status: "error", error: "Missing worktree data" };
    }

    try {
      cleanupWorktree(worktreePath, branchName);
    } catch {
      // Best effort cleanup
    }

    return { status: "confirmed" };
  },
});

registerCardHandler("code:stop", {
  label: "Stop Session",
  successMessage: "Session stopped",
  confirmMessage: "Stop the running coding session?",

  async execute(data) {
    const sessionId = data.sessionId as string;
    const worktreePath = data.worktreePath as string;
    const branchName = data.branchName as string;

    const session = activeSessions.get(sessionId);
    if (session) {
      session.kill();
      activeSessions.delete(sessionId);
    }

    if (worktreePath && branchName) {
      try {
        cleanupWorktree(worktreePath, branchName);
      } catch {
        // Best effort
      }
    }

    return { status: "confirmed" };
  },
});

/**
 * Get currently active sessions (for status checks).
 */
export function getActiveSessions(): Map<string, ActiveSession> {
  return activeSessions;
}
```

**Step 2: Register handler import in API route**

In `src/app/api/action-card/[id]/route.ts`, add after the vault import (line 11):

```typescript
import "@/lib/action-cards/handlers/code";
```

**Step 3: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/lib/action-cards/handlers/code.ts src/app/api/action-card/[id]/route.ts
git commit -m "feat(code): action card handlers — start, approve, reject, stop (PER-213)"
```

---

### Task 7: Code Card UI Component

**Files:**
- Create: `src/components/aurelius/cards/code-card.tsx`
- Modify: `src/components/aurelius/cards/card-content.tsx:8-31` (add code pattern route)

**Step 1: Create the code card component**

Create `src/components/aurelius/cards/code-card.tsx`:

```tsx
"use client";

import type { ActionCardData } from "@/lib/types/action-card";

interface CodeCardContentProps {
  card: ActionCardData;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

export function CodeCardContent({ card, onAction }: CodeCardContentProps) {
  const data = card.data;
  const task = data.task as string;
  const context = data.context as string | null;
  const branchName = data.branchName as string;
  const sessionStatus = (data.status as string) || 'pending';
  const result = data.result as {
    turns?: number;
    durationMs?: number;
    stats?: { filesChanged: number; insertions: number; deletions: number; summary: string };
    changedFiles?: string[];
    log?: string;
  } | undefined;

  // Pending — waiting for user to start
  if (card.status === 'pending' && sessionStatus === 'pending') {
    return (
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">Task: </span>
          <span className="text-foreground">{task}</span>
        </div>
        {context && (
          <div>
            <span className="text-muted-foreground">Context: </span>
            <span className="text-foreground">{context}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Branch: </span>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{branchName}</code>
        </div>
      </div>
    );
  }

  // Running — session in progress
  if (card.status === 'confirmed' && sessionStatus !== 'completed') {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-foreground font-medium">Session running...</span>
        </div>
        <div>
          <span className="text-muted-foreground">Task: </span>
          <span className="text-foreground">{task}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Branch: </span>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{branchName}</code>
        </div>
      </div>
    );
  }

  // Completed — show results with approve/reject
  if (sessionStatus === 'completed' && result) {
    const stats = result.stats;
    const durationSec = result.durationMs ? Math.round(result.durationMs / 1000) : null;

    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-foreground font-medium">Session complete</span>
          {durationSec && (
            <span className="text-muted-foreground">({durationSec}s, {result.turns} turns)</span>
          )}
        </div>

        {stats && stats.filesChanged > 0 && (
          <div className="rounded-md bg-muted/50 p-3 space-y-2">
            <div className="font-medium">{stats.filesChanged} file{stats.filesChanged !== 1 ? 's' : ''} changed</div>
            <div className="flex gap-3 text-xs">
              <span className="text-green-600">+{stats.insertions}</span>
              <span className="text-red-600">-{stats.deletions}</span>
            </div>
            {result.changedFiles && result.changedFiles.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {result.changedFiles.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {result.log && (
          <div>
            <div className="text-muted-foreground text-xs mb-1">Commits:</div>
            <pre className="text-xs bg-muted/50 rounded p-2 whitespace-pre-wrap">{result.log}</pre>
          </div>
        )}

        {/* Approve/Reject buttons are rendered by the parent ActionCard via onAction */}
      </div>
    );
  }

  // Error state
  if (card.status === 'error') {
    const error = (card.result as Record<string, unknown>)?.error as string;
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-foreground font-medium">Session failed</span>
        </div>
        {error && <div className="text-red-600 text-xs">{error}</div>}
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-sm text-muted-foreground">
      {task}
    </div>
  );
}
```

**Step 2: Route "code" pattern in CardContent**

In `src/components/aurelius/cards/card-content.tsx`, add the import and case:

Add import at line 8 (after VaultCardContent):
```typescript
import { CodeCardContent } from "./code-card";
```

Add case before the default in the switch (after vault case at line 30):
```typescript
    case "code":
      return <CodeCardContent card={card} onAction={onAction} />;
```

**Step 3: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/components/aurelius/cards/code-card.tsx src/components/aurelius/cards/card-content.tsx
git commit -m "feat(code): code card UI — pending, running, result, error states (PER-213)"
```

---

### Task 8: Integration Test — End-to-End Smoke Test

**Files:**
- None created. This is a manual verification task.

**Step 1: Verify TypeScript compiles clean**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors introduced by this feature (pre-existing errors are known, PER-199).

**Step 2: Verify the dev server starts**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run dev`
Expected: Server starts without import/module errors.

**Step 3: Verify claude CLI is available**

Run: `which claude && claude --version`
Expected: Shows path and version (v2.x).

**Step 4: Verify worktree base directory is writable**

Run: `ls -la "/Users/markwilliamson/Claude Code/" | grep aurelius`
Expected: The parent directory exists and is writable.

**Step 5: Manual smoke test**

In the web chat, type: "Fix the TypeScript errors in the codebase"

Expected flow:
1. Agent calls `start_coding_session` tool
2. Action card appears with task details and "Start Session" button
3. Click "Start Session" → worktree created, claude -p spawned
4. Card updates to "Session running..." state
5. On completion → card shows diff stats, file list, commit log
6. "Approve & Merge" and "Reject" buttons appear
7. Click "Reject" → worktree cleaned up, card dismissed

**Step 6: Commit verification checkpoint**

```bash
git log --oneline feature/aurelius-can-code
```

Expected: 7 commits from tasks 1-7.

---

### Task 9: Wire Up ActionCard Buttons for Code Pattern

The existing ActionCard component renders buttons based on the card handler. For the code pattern, the card goes through multiple states:

1. **Pending** → "Start Session" button (handled by `code:start`)
2. **Running** → "Stop" button (handled by `code:stop`)
3. **Completed** → "Approve & Merge" + "Reject" buttons (handled by `code:approve` / `code:reject`)

The current `dispatchCardAction` in the registry already supports action-specific handlers (e.g., `code:approve` when handler is `code:start` and action is `approve`). The UI needs to know which buttons to show based on the card's current state.

**Files:**
- Modify: `src/components/aurelius/cards/code-card.tsx` (add action buttons)

**Step 1: Update code-card.tsx to include action buttons**

The buttons should call `onAction` with the appropriate action string. The parent `ActionCard` component handles the API call to `/api/action-card/[id]`.

Update the "completed" section of `code-card.tsx` to add approve/reject buttons:

```tsx
{/* After the commits section in the completed block */}
<div className="flex gap-2 pt-2">
  <button
    onClick={() => onAction?.('approve', { worktreePath: data.worktreePath, branchName })}
    className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700"
  >
    Approve & Merge
  </button>
  <button
    onClick={() => onAction?.('reject', { worktreePath: data.worktreePath, branchName })}
    className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/80"
  >
    Reject
  </button>
</div>
```

Update the "running" section to add a stop button:

```tsx
{/* After the branch name in the running block */}
<button
  onClick={() => onAction?.('stop', { sessionId: data.sessionId, worktreePath: data.worktreePath, branchName })}
  className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 mt-2"
>
  Stop Session
</button>
```

**Step 2: Check how the existing ActionCard component calls onAction**

Read `src/components/aurelius/action-card.tsx` to understand the button/action flow. The code card needs to either:
- Use the built-in primary action button (if the card pattern supports it), OR
- Render its own buttons that call `onAction` which the parent translates to API calls

This step may require adjustments based on how the parent ActionCard works. Read the file and adapt.

**Step 3: Verify TypeScript compiles**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/components/aurelius/cards/code-card.tsx
git commit -m "feat(code): code card action buttons — approve, reject, stop (PER-213)"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB migration (enum values) | migration SQL, config.ts, action-cards.ts |
| 2 | Worktree management | code/worktree.ts |
| 3 | Executor (spawn + parse) | code/executor.ts |
| 4 | Prompt builder | code/prompts.ts |
| 5 | Capability module | code/index.ts, capabilities/index.ts |
| 6 | Action card handlers | handlers/code.ts, route.ts |
| 7 | Code card UI | code-card.tsx, card-content.tsx |
| 8 | Smoke test | Manual verification |
| 9 | Action buttons | code-card.tsx update |

**Total new files:** 5 (`worktree.ts`, `executor.ts`, `prompts.ts`, `code/index.ts`, `handlers/code.ts`, `code-card.tsx`, migration SQL)
**Modified files:** 4 (`config.ts`, `action-cards.ts`, `capabilities/index.ts`, `card-content.tsx`, `route.ts`)

This covers Phase 1 (Core MVP) from the design doc. After this, you can say "fix the TS errors" in web chat and get a full coding session with worktree isolation and approve/reject flow.
