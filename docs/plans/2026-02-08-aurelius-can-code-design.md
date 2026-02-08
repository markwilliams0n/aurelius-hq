# Aurelius Can Code — Design Document

> Aurelius spawns Claude Code sessions to work on its own codebase, triggered by natural language from chat, Telegram, or Linear issues. Work is reviewed and approved before merging.

**Date:** 2026-02-08
**Branch:** `feature/aurelius-can-code`
**Linear:** TBD

---

## Overview

Add a `code` capability that lets Aurelius recognize coding tasks and spawn Claude Code CLI sessions to execute them. Each session runs in an isolated git worktree, and results are presented for user approval before merging to main.

### What This Enables

- "Fix the 32 TypeScript errors" → Aurelius does it, shows you the diff, you approve
- Linear issue triaged as actionable → Aurelius offers to work on it
- "Add a loading spinner to the triage page" from Telegram → coding session starts
- Aurelius notices something it could fix → proactively offers

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Autonomy model | Review-first (action card approval) | Matches existing patterns (Slack, vault). Safe. Can relax later. |
| Implementation | CLI (`claude -p`) not SDK | Uses Max subscription directly. No 72MB dep. CLI is already authenticated. |
| Git isolation | Worktrees | Dev server runs from main. Worktree gives Claude Code its own copy. |
| Chat surface | Reuse `useChat` with `surface: "code"` | Less new UI. Same hook, different context. Build dedicated page later if needed. |
| Session storage | Action card JSONB fields (v1) | No new table. Execution data in card's `data`/`result`. Add table later for querying. |
| Memory | Summaries at key points | Don't stream raw output to Supermemory. Structured summaries on start/complete/approve. |
| Telegram | Approvals + milestones | Not full stream. User can check in proactively. |

---

## Architecture

### Flow

```
Trigger (chat / Telegram / Linear issue)
  ↓
Aurelius agent (OpenRouter) recognizes coding task
  ↓
Calls start_coding_session tool
  ↓
Returns action card: "Ready to start coding session"
  → Shows task description, "Start" button
  ↓
User approves (or auto-start for future low-risk tasks)
  ↓
Handler:
  1. Creates git worktree from main → ../aurelius-worktrees/<session-id>
  2. Spawns `claude -p` in the worktree
  3. Parses NDJSON stream → emits progress to chat
  4. On completion: captures diff, commit SHA, test results
  ↓
Presents result action card:
  → Summary of changes
  → Files changed, lines added/removed
  → Test results (pass/fail)
  → "Approve & Merge" / "Reject" buttons
  ↓
Approve → fast-forward merge worktree branch to main, cleanup
Reject → delete worktree, nothing changes
```

### System Diagram

```
┌──────────────────┐     ┌──────────────────┐
│  Web Chat        │     │  Telegram         │
│  surface: "code" │     │  milestone msgs   │
└────────┬─────────┘     └────────┬──────────┘
         │                        │
         ▼                        ▼
┌──────────────────────────────────────────┐
│  /api/chat  (unified chat endpoint)      │
│  → buildAgentContext(surface: "code")    │
│  → chatStreamWithTools()                │
│  → agent calls start_coding_session     │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│  Code Capability Handler                 │
│  1. Create action card (pending)         │
│  2. On approval → executor.start()       │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│  Executor                                │
│  1. git worktree add ../worktrees/<id>   │
│  2. spawn('claude', ['-p', ...])         │
│  3. Parse NDJSON → progress events       │
│  4. On complete → capture diff, tests    │
│  5. Update action card with results      │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│  Result Action Card                      │
│  Approve → git merge, cleanup worktree   │
│  Reject → delete worktree               │
└──────────────────────────────────────────┘
```

---

## Capability Module

### Tool Definition

```typescript
// src/lib/capabilities/code/index.ts
const tools = [{
  name: "start_coding_session",
  description: `Start a Claude Code session to work on the Aurelius HQ codebase.
    Use this when the user asks you to fix bugs, add features, refactor code,
    run tests, or do any development work on Aurelius itself.
    Also use when a Linear issue describes code work that can be acted on.`,
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear description of what to build, fix, or change"
      },
      context: {
        type: "string",
        description: "Relevant file paths, error messages, Linear issue details"
      },
      branch_name: {
        type: "string",
        description: "Suggested branch name (e.g., 'fix-ts-errors'). Auto-generated if omitted."
      }
    },
    required: ["task"]
  }
}];
```

### Handler

The tool handler does NOT execute immediately. It returns an action card:

```typescript
async function handleTool(toolName: string, input: Record<string, unknown>, conversationId?: string) {
  if (toolName !== 'start_coding_session') return null;

  const { task, context, branch_name } = input;
  const sessionId = nanoid();
  const branchName = branch_name || slugify(task);

  return {
    result: JSON.stringify({
      action_card: {
        pattern: 'code',
        handler: 'code:start',
        title: `Coding Session: ${truncate(task, 60)}`,
        data: {
          sessionId,
          task,
          context: context || null,
          branchName: `aurelius/${branchName}`,
          maxTurns: 25,
          timeoutMs: 300_000,
        }
      },
      summary: `Prepared coding session: ${truncate(task, 80)}`
    })
  };
}
```

### Prompt Template

The prompt sent to Claude Code enriches the user's request:

```typescript
function buildCodePrompt(task: string, context?: string): string {
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
- Run \`vitest run\` if you changed code near existing tests
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
```

---

## Executor

### Spawning Claude Code

```typescript
// src/lib/capabilities/code/executor.ts
import { spawn } from 'child_process';

interface CodeSessionOptions {
  sessionId: string;
  task: string;
  context?: string;
  branchName: string;
  worktreePath: string;
  maxTurns: number;
  timeoutMs: number;
  onProgress: (event: ProgressEvent) => void;
  onComplete: (result: SessionResult) => void;
  onError: (error: Error) => void;
}

function startSession(options: CodeSessionOptions): { pid: number; kill: () => void } {
  const prompt = buildCodePrompt(options.task, options.context);

  const child = spawn('claude', [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--max-turns', String(options.maxTurns),
    '--permission-mode', 'acceptEdits',
    '--allowedTools', getAllowedTools().join(' '),
    '--append-system-prompt', getSystemAppend(),
    '--no-session-persistence',
  ], {
    cwd: options.worktreePath,
    timeout: options.timeoutMs,
    env: buildSafeEnv(),
  });

  // Parse NDJSON stream for progress
  parseStream(child.stdout, options.onProgress, options.onComplete);

  child.on('error', options.onError);
  child.on('exit', (code) => {
    if (code !== 0) options.onError(new Error(`claude exited with code ${code}`));
  });

  return {
    pid: child.pid!,
    kill: () => child.kill('SIGTERM'),
  };
}
```

### Allowed Tools

```typescript
function getAllowedTools(): string[] {
  return [
    'Read', 'Edit', 'Write', 'Glob', 'Grep',
    'Bash(git:*)',
    'Bash(npx tsc:*)',
    'Bash(vitest:*)',
    'Bash(bun add:*)',
    'Bash(bun run:*)',
    'Bash(bunx drizzle-kit:*)',
    'Bash(ls:*)',
    'Bash(cat:*)',
    'Bash(head:*)',
    'Bash(tail:*)',
    'Bash(wc:*)',
  ];
}
```

### Safe Environment

Strip sensitive vars that Claude Code doesn't need:

```typescript
function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    SHELL: process.env.SHELL || '/bin/zsh',
    LANG: process.env.LANG || 'en_US.UTF-8',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // DO NOT include ANTHROPIC_API_KEY → forces Max subscription
  };

  // Pass through only what Claude Code needs for the project
  const passthrough = ['NODE_ENV'];
  for (const key of passthrough) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }

  return safe;
}
```

### NDJSON Stream Parser

```typescript
function parseStream(
  stdout: Readable,
  onProgress: (event: ProgressEvent) => void,
  onComplete: (result: SessionResult) => void,
) {
  let lastToolName = '';

  const rl = readline.createInterface({ input: stdout });

  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);

      if (event.type === 'assistant') {
        for (const block of event.message?.content || []) {
          if (block.type === 'text') {
            onProgress({ type: 'thinking', text: block.text });
          }
          if (block.type === 'tool_use') {
            lastToolName = block.name;
            onProgress({
              type: 'tool_call',
              tool: block.name,
              input: summarizeToolInput(block.name, block.input),
            });
          }
        }
      }

      if (event.type === 'result') {
        onComplete({
          sessionId: event.session_id,
          turns: event.num_turns,
          durationMs: event.duration_ms,
          costUsd: event.total_cost_usd, // null for Max subscription
        });
      }
    } catch {
      // Skip malformed lines
    }
  });
}
```

---

## Git Worktree Management

```typescript
// src/lib/capabilities/code/worktree.ts
import { spawnSync } from 'child_process';

const WORKTREE_BASE = path.resolve(process.cwd(), '..', 'aurelius-worktrees');
const REPO_ROOT = process.cwd();

function createWorktree(branchName: string, sessionId: string): string {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);

  // Ensure base directory exists
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });

  // Create worktree on a new branch from main
  const result = spawnSync('git', [
    'worktree', 'add',
    '-b', branchName,
    worktreePath,
    'main',
  ], { cwd: REPO_ROOT, stdio: 'pipe' });

  if (result.status !== 0) {
    throw new Error(`Failed to create worktree: ${result.stderr?.toString()}`);
  }

  return worktreePath;
}

function getWorktreeDiff(worktreePath: string): string {
  const result = spawnSync('git', ['diff', 'main...HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
    maxBuffer: 500 * 1024, // 500KB max diff
  });
  return result.stdout?.toString() || '';
}

function getWorktreeStats(worktreePath: string): { filesChanged: number; insertions: number; deletions: number } {
  const result = spawnSync('git', ['diff', '--stat', 'main...HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
  });
  // Parse "8 files changed, 45 insertions(+), 38 deletions(-)"
  const summary = result.stdout?.toString().trim().split('\n').pop() || '';
  // ... parse numbers
  return { filesChanged: 0, insertions: 0, deletions: 0 };
}

function mergeWorktree(worktreePath: string, branchName: string): void {
  // Merge the worktree branch into main
  spawnSync('git', ['merge', '--ff-only', branchName], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  // Cleanup
  cleanupWorktree(worktreePath, branchName);
}

function cleanupWorktree(worktreePath: string, branchName: string): void {
  spawnSync('git', ['worktree', 'remove', worktreePath], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  spawnSync('git', ['branch', '-d', branchName], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
}
```

---

## Action Card Handlers

### Start Handler

```typescript
// src/lib/action-cards/handlers/code.ts

registerCardHandler('code:start', {
  label: 'Start Session',
  successMessage: 'Coding session started',
  async execute(data) {
    const { sessionId, task, context, branchName, maxTurns, timeoutMs } = data;

    // Create worktree
    const worktreePath = createWorktree(branchName, sessionId);

    // Start claude session (non-blocking — runs in background)
    const session = startSession({
      sessionId,
      task,
      context,
      branchName,
      worktreePath,
      maxTurns,
      timeoutMs,
      onProgress: (event) => emitProgressToChat(sessionId, event),
      onComplete: (result) => onSessionComplete(sessionId, worktreePath, branchName, result),
      onError: (error) => onSessionError(sessionId, worktreePath, branchName, error),
    });

    // Track PID for kill switch
    activeSessions.set(sessionId, session);

    return { status: 'confirmed' };
  }
});

registerCardHandler('code:approve', {
  label: 'Approve & Merge',
  successMessage: 'Changes merged to main!',
  confirmMessage: 'Merge these changes into main?',
  async execute(data) {
    const { worktreePath, branchName, sessionId } = data;

    mergeWorktree(worktreePath, branchName);

    // Save summary to Supermemory
    await saveCodeMemory(sessionId, 'approved', data.summary);

    return { status: 'confirmed' };
  }
});

registerCardHandler('code:reject', {
  label: 'Reject',
  successMessage: 'Changes discarded',
  async execute(data) {
    const { worktreePath, branchName, sessionId } = data;

    cleanupWorktree(worktreePath, branchName);

    await saveCodeMemory(sessionId, 'rejected', data.summary);

    return { status: 'confirmed' };
  }
});

registerCardHandler('code:stop', {
  label: 'Stop',
  successMessage: 'Session stopped',
  async execute(data) {
    const session = activeSessions.get(data.sessionId);
    if (session) {
      session.kill();
      activeSessions.delete(data.sessionId);
    }
    cleanupWorktree(data.worktreePath, data.branchName);
    return { status: 'confirmed' };
  }
});
```

---

## Telegram Integration

Telegram gets lightweight updates, not the full stream.

### Milestone Messages

```typescript
// Events that trigger Telegram notifications:
const TELEGRAM_EVENTS = {
  'session_started':  '🔧 Started coding: {task}',
  'milestone':        '→ {message}',         // max 3-4 per session
  'tests_passed':     '✅ Tests passing ({count} tests)',
  'tests_failed':     '❌ {count} tests failing',
  'session_complete': '✅ Done ({duration}s). {filesChanged} files, +{ins} −{del}',
  'session_error':    '❌ Session failed: {error}',
  'awaiting_review':  '📋 Changes ready for review. Reply "approve" or "reject".',
};
```

### Telegram Approve/Reject

User can reply in Telegram:
- "approve" / "yes" / "merge" → triggers code:approve handler
- "reject" / "no" / "discard" → triggers code:reject handler
- "status" / "what's happening" → current session status
- "stop" / "cancel" → kills active session

This is handled in the Telegram message handler by detecting these keywords when an active coding session exists.

---

## Memory Integration

### What Goes to Supermemory

```typescript
async function saveCodeMemory(sessionId: string, outcome: string, summary: string) {
  const memory = formatCodeMemory(sessionId, outcome, summary);
  await addMemory(memory, { containerTag: 'mark' });
}

function formatCodeMemory(sessionId: string, outcome: string, summary: string): string {
  // Example output:
  // "Coding session (2026-02-08): Fixed 32 TypeScript errors across 8 files.
  //  Key changes: updated test fixtures, added missing type imports.
  //  Outcome: approved and merged to main."
  return `Coding session (${today()}): ${summary}\nOutcome: ${outcome}.`;
}
```

### What Goes to Daily Notes

Append to daily notes on session completion (same as conversation memory extraction):
```
## Coding Session — fix TypeScript errors
- Task: Fix 32 pre-existing TypeScript errors
- Result: 8 files changed, +45 -38
- Tests: 14 passed
- Outcome: approved
```

---

## Security Guardrails

### Permission Model

| Control | Setting |
|---|---|
| Permission mode | `acceptEdits` (auto-approve file edits, block unapproved Bash) |
| Allowed Bash | `git`, `tsc`, `vitest`, `bun add/run`, `drizzle-kit`, `ls/cat/head/tail/wc` |
| Blocked Bash | Everything else (curl, wget, ssh, npm exec, etc.) |
| Max turns | 25 (configurable per session) |
| Timeout | 5 minutes (configurable per session) |
| Session persistence | Disabled (`--no-session-persistence`) |
| Environment | Stripped — only PATH, HOME, SHELL, LANG, NODE_ENV |
| Working directory | Isolated git worktree (not the running codebase) |
| Network | Inherits for Anthropic API only; no explicit network tools allowed |
| Budget | No `--max-budget-usd` (Max subscription). Controlled via max turns + timeout. |

### Environment Isolation

Claude Code sessions do NOT receive:
- `DATABASE_URL` (no direct DB access)
- `OPENROUTER_API_KEY`
- `SUPERMEMORY_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY` (forces Max subscription auth)
- Any other secret from `.env.local`

Claude Code can still read `.env.local` from the worktree (file access). To prevent this:
- The worktree is created from git (clean checkout) — `.env.local` is gitignored, so it won't be in the worktree
- `.env` (if committed) would be there — ensure secrets aren't committed

### Process Management

- Track PIDs of all active sessions in a `Map<sessionId, { pid, kill }>`
- Kill switch available in UI and Telegram
- On server shutdown (SIGTERM), kill all active sessions
- Maximum 1 concurrent session (v1) — reject new sessions while one is active

---

## DB Migrations Required

### 1. Config key enum

```sql
ALTER TYPE config_key ADD VALUE 'capability:code';
```

### 2. Card pattern enum

```sql
ALTER TYPE card_pattern ADD VALUE 'code';
```

No new tables for v1.

---

## File Structure

```
src/lib/capabilities/code/
├── index.ts          # Capability export: tool + prompt + handler
├── executor.ts       # Spawn claude -p, parse NDJSON, progress events
├── worktree.ts       # Git worktree create / merge / cleanup
└── prompts.ts        # Prompt templates

src/lib/action-cards/handlers/
└── code.ts           # code:start, code:approve, code:reject, code:stop

src/components/aurelius/cards/
└── code-card.tsx     # Progress view + diff + approve/reject UI

src/app/code/
├── page.tsx          # Code sessions list
└── [id]/page.tsx     # Session detail (reuses useChat with surface: "code")
```

---

## Implementation Phases

### Phase 1: Core (MVP)

1. DB migration (config key + card pattern enums)
2. Capability module with `start_coding_session` tool
3. Worktree management (create, diff, merge, cleanup)
4. Executor (spawn claude, parse NDJSON, progress callbacks)
5. Action card handlers (start, approve, reject, stop)
6. Basic code card UI (progress log + approve/reject)
7. Wire into chat API (capability registered, tool available)

**Result:** You can say "fix the TS errors" in web chat, approve the session start, watch progress, review diff, approve merge.

### Phase 2: Telegram + Polish

8. Telegram milestone notifications
9. Telegram approve/reject via reply keywords
10. Telegram "status" / "stop" commands
11. Diff viewer in code card (syntax highlighted, file-by-file)
12. Session kill switch in UI
13. `/code` list page + `/code/[id]` detail page

**Result:** Full Telegram workflow. Better diff viewing.

### Phase 3: Intelligence

14. Supermemory integration (summaries on start/complete/approve)
15. Daily notes integration
16. Linear issue context injection (when triggered from triage)
17. Aurelius proactively suggests coding sessions
18. Session resume (`--resume` for multi-turn sessions)

**Result:** Aurelius learns from past sessions. Can work on Linear issues. Gets smarter over time.

### Phase 4: Advanced (Future)

19. Concurrent sessions (multiple worktrees)
20. Auto-start for low-risk tasks (tsc, lint fixes)
21. MCP config for giving Claude Code access to Aurelius context
22. Docker sandboxing for full-capability sessions
23. Cost tracking and usage dashboard

---

## Open Questions

1. **Should Claude Code have access to ARCHITECTURE.md / CLAUDE.md?** These are in git, so they'll be in the worktree. Probably good — they help Claude Code understand the codebase. But CLAUDE.md has process safety rules that apply to interactive Claude Code, not headless. May need a separate `.claude/CLAUDE.md` for headless sessions or use `--setting-sources` to control.

2. **What if the merge isn't fast-forward?** If main has moved since the worktree was created, ff-only merge will fail. Options: rebase the worktree branch, or re-run the session on fresh main. For v1, just fail and tell the user.

3. **Should sessions be resumable?** If a session runs out of turns or times out partway through, can you continue it? The `--resume` flag supports this. Probably Phase 3.

4. **What about the dev server?** After merging changes to main, the Next.js dev server will hot-reload. Some changes (new deps, schema changes) need a server restart. Should Aurelius offer to restart?
