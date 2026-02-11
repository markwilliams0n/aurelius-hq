# Autonomous Code Agent Design

> **Date:** 2026-02-10
> **Status:** Draft

## Goal

Give Aurelius fully autonomous coding capability over his own codebase. No permission prompts during execution. User monitors via Telegram notifications and reviews via GitHub PRs. Agent can be triggered by user command OR pick up work automatically via heartbeat.

## Lifecycle

```
TRIGGER (user command or heartbeat)
  ↓
CREATE WORKTREE (isolated branch)
  ↓
PLANNING RUN (read-only Claude invocation → structured plan)
  ↓
PLAN NOTIFICATION (Telegram with Approve/Edit, 20-min auto-approve timer)
  ↓
EXECUTION RUN (autonomous Claude with --dangerously-skip-permissions)
  ↓
PUSH + PR (git push, gh pr create)
  ↓
COMPLETION NOTIFICATION (Telegram with PR link + stats)
```

## Dual Trigger Model

### User-Commanded
User says "fix the TS errors in triage" via Telegram or web chat. Aurelius starts immediately — creates worktree, plans, notifies, executes.

### Heartbeat-Triggered
Existing 15-minute heartbeat checks Linear for issues assigned to Aurelius (or labeled `aurelius`) in Todo state. If found and no active session and no open PR waiting for review, Aurelius picks it up and follows the same pipeline.

`heartbeatEnabled` defaults to `false` — turned on manually once the system is trusted.

## Planning Phase

Separate Claude CLI invocation, read-only:

```
claude -p "<task + context>" \
  --permission-mode plan \
  --output-format stream-json \
  --cwd <worktree-path> \
  --append-system-prompt "<planning prompt>"
```

- Reads the codebase, understands the problem
- Produces a structured plan (files to change, approach, risks)
- Cannot make edits (plan permission mode = read-only tools only)
- Exits after one turn with plan as output

Plan is sent to Telegram with Approve / Edit buttons. 20-minute timer starts:
- **Approve** → execution starts immediately
- **Reply with edits** → plan amended, timer resets
- **20 minutes pass** → auto-approved, execution starts

## Execution Phase

Second Claude CLI invocation, fully autonomous:

```
claude -p "<approved plan + task context>" \
  --dangerously-skip-permissions \
  --output-format stream-json \
  --cwd <worktree-path> \
  --append-system-prompt "<execution prompt>"
```

Key properties:
- **No stdin interaction** — process runs to completion unattended
- **Plan is the entire prompt** — Claude gets the approved plan as input, works until done
- **Commits incrementally** — meaningful chunks, not one giant commit
- **Tests after changes** — `tsc --noEmit`, `vitest`, iterates on failures (max 3 retries per issue)
- **Finishes with PR** — `git push -u origin <branch>` then `gh pr create`

### Safety Valves
- **Cost ceiling**: Kill process if cumulative cost exceeds configured limit ($20 default)
- **Time ceiling**: Kill process if elapsed time exceeds configured limit (120 min default)
- **Error handling**: On crash, worktree preserved for inspection or resume

### Progress Monitoring
- Logs stream to `logs/code-sessions/<sessionId>.log`
- Telegram gets informational updates at milestones (tests running, pushing, etc.)
- All notifications are passive — no response needed
- Web UI session detail page still works for live log viewing

## Completion

When execution finishes successfully:

```
Aurelius pushes branch → creates PR → updates action card → Telegram:

"PR ready: Fix triage TypeScript errors
 github.com/markwilliamson/aurelius-hq/pull/42
 5 files · +120 -45 · tests passing
 Cost: $3.20 · 12 turns · 8 minutes"
```

User reviews PR on GitHub, merges when ready.

## Configuration

New config key `capability:code-agent` — editable via web UI config system with versioning and diff review.

```json
{
  "planning": {
    "autoApproveMinutes": 20,
    "maxPlanningCostUsd": 1
  },
  "execution": {
    "maxCostUsd": 20,
    "maxDurationMinutes": 120,
    "maxRetries": 3,
    "allowedTools": [
      "Read", "Edit", "Write", "Glob", "Grep",
      "Bash(git *)", "Bash(tsc *)", "Bash(vitest *)", "Bash(bun *)"
    ],
    "commitStrategy": "incremental"
  },
  "triggers": {
    "heartbeatEnabled": false,
    "linearLabel": "aurelius",
    "maxConcurrentSessions": 1,
    "pauseIfOpenPR": true
  },
  "notifications": {
    "onPlanReady": true,
    "onProgressMilestones": true,
    "onComplete": true,
    "onError": true
  }
}
```

## Codebase Changes

### 1. DB Migration
- Add `capability:code-agent` to `configKeyEnum`
- Seed with default config JSON

### 2. `src/lib/code/executor.ts` — new execution mode
- New `startAutonomousSession()` function
- Uses `--dangerously-skip-permissions`
- No stdin — plan sent as `-p` prompt, monitors stdout only
- Tracks cumulative cost from NDJSON `result` events, kills at ceiling
- Tracks elapsed time, kills at duration limit
- On completion: `git push` + `gh pr create` from worktree

### 3. `src/lib/code/lifecycle.ts` — autonomous flow
- New `startAutonomousFlow(task, context?)` entry point
- Phase 1: Create worktree → spawn planning run → capture plan
- Phase 2: Send plan to Telegram + start auto-approve timer
- Phase 3 (on approve or timeout): spawn execution run → monitor
- Phase 4: Parse PR URL → update card → notify

### 4. `src/lib/code/prompts.ts` — two new prompts
- `buildPlanningPrompt(task, context)` — read-only, structured plan output
- `buildExecutionPrompt(plan, task, config)` — follow plan, test, commit, push, PR

### 5. `src/lib/code/telegram.ts` — new notification types
- Plan ready: Approve / Edit buttons + countdown timer text
- Progress milestones: informational, no buttons
- PR ready: link + stats

### 6. `src/lib/memory/heartbeat.ts` — work intake
- After connector syncs, check Linear for `aurelius`-labeled Todo issues
- Guard: no active session, no open PR, `heartbeatEnabled` is true
- Calls `startAutonomousFlow()` with Linear issue context

### 7. `src/lib/action-cards/handlers/code.ts` — new handlers
- `code:approve-plan` — triggers execution phase
- `code:edit-plan` — amends plan, resets timer
- Existing manual session handlers can coexist

### 8. Config capability registration
- Register `capability:code-agent` schema in capabilities system
- Seed defaults on first access

### What Stays the Same
- Worktree creation/cleanup (`worktree.ts`)
- Session manager global state pattern (new fields for timer)
- Action card DB schema and patterns (new states)
- Web UI session list/detail (add plan display + PR link)
- Existing interactive session flow (coexists for when you want manual control)

## Research Context

Design informed by analysis of: OpenHands (container sandbox + event stream), Claude Code headless mode (--dangerously-skip-permissions + hooks), SWE-agent (ACI design), Devin (cloud sandbox + interactive planning), Cursor background agents (cloud VMs), GitHub Copilot coding agent (ephemeral runners + draft PRs).

Key insight: worktree isolation provides sufficient sandboxing for `--dangerously-skip-permissions` since the agent can only modify its own isolated branch, not the running dev server or main branch.
