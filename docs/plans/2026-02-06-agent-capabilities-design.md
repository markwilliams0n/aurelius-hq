# Agent Capabilities System + Tasks Capability

> Design for extensible agent capabilities, with Tasks as the first implementation.

## Problem

The agent currently has 3 hardcoded config tools and no ability to act on tasks, reminders, or other domains. We need:

1. A pattern for adding agent capabilities that scales to future features (web search, reminders, Claude Code sessions, etc.)
2. Tasks as the first capability — chat about tasks, create/update via Linear, surface suggested tasks from triage
3. The agent to be self-aware of its capabilities and able to act autonomously

## Design

### Capability Structure

Each capability lives in `src/lib/capabilities/<name>/` with a known structure:

```
src/lib/capabilities/
├── index.ts              # Discovery: collects tools + prompts from all capabilities
├── types.ts              # Capability interface
│
├── config/               # Existing config tools, migrated
│   ├── capability.md
│   ├── tools.ts
│   └── index.ts
│
├── tasks/                # NEW: first real capability
│   ├── capability.md
│   ├── tools.ts
│   └── index.ts
│
└── (future)
    ├── reminders/
    ├── web-search/
    └── ...
```

### Capability Interface

Each capability exports:

```typescript
interface Capability {
  name: string;
  tools: ToolDefinition[];
  prompt: string;           // contents of capability.md
  heartbeatHook?: () => Promise<HeartbeatHookResult>;  // future: autonomous behaviors
}
```

Tool definitions follow the existing pattern (OpenAI function calling format):

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}
```

### capability.md — The Tunable Part

Each capability has a markdown file that:

- Tells the agent what the capability does and when to use it
- Contains defaults and behavioral guidance
- Is included verbatim in the system prompt under `## Available Capabilities`
- Can be modified by the agent via the config approval system (propose change → user approves)

Example `tasks/capability.md`:

```markdown
# Tasks

You can manage tasks via Linear. You have access to tools for creating,
updating, listing, and inspecting tasks.

## When to use

- When the user mentions something they need to do, offer to create a task
- When asked about priorities or what to work on, list current tasks and help sequence them
- When you see suggested tasks from triage (meetings, emails), propose creating them in Linear
- Reference tasks by their identifier (e.g. ENG-123) when discussing them

## Defaults

- Default team: Personal
- Confirm before creating or updating tasks
- When a suggested task has an assignee, look up that person in Linear team members and propose assigning to them

## Suggested tasks from triage

When suggested tasks exist (from Granola meetings, emails, etc.):
- Match the assignee name against Linear team members
- For tasks assigned to others, propose creating and assigning in Linear
- For tasks assigned to the user, propose creating in the user's default team
- Always ask for confirmation before creating

## Task context

When discussing tasks, use memory (Supermemory) to recall relevant context
about projects, people, and preferences. Defaults above are the baseline;
learned preferences from conversation history take precedence.
```

### Integration Points

**All chat surfaces get capabilities automatically.** The three chat endpoints (main chat, triage chat, Telegram) all use `chatStreamWithTools()`. Capabilities wire in at two points:

#### 1. Tools → `chatStreamWithTools()`

```
// capabilities/index.ts
export function getAllTools(): ToolDefinition[] {
  // Auto-discover all capability folders, collect their tools
  return [...configTools, ...taskTools, ...futureTools];
}
```

`chatStreamWithTools()` calls `getAllTools()` instead of hardcoding `CONFIG_TOOLS`. Tool dispatch looks up the handler by name — no changes to the tool loop.

#### 2. Prompts → system prompt builder

```
// capabilities/index.ts
export function getCapabilityPrompts(): string {
  // Reads each capability.md and formats them
  return `## Available Capabilities\n\n${allPrompts}`;
}
```

`buildAgentContext()` (in `src/lib/ai/context.ts`) includes the capability prompts section in the system prompt. Every chat surface that uses `buildAgentContext()` gets the capability context.

#### 3. Config system → capability.md editing

The existing config approval system (`propose_config_change`) is extended to support capability files. The agent can propose changes to any `capability.md`, which go through the same approval flow as soul/system_prompt changes.

### Tasks Capability — Tools

| Tool | Description | Wraps |
|------|-------------|-------|
| `list_tasks` | List current tasks. Optional filters: status, project, priority | `fetchAllMyTasks()` from `linear/issues.ts` |
| `create_task` | Create a new task in Linear | `createIssue()` |
| `update_task` | Update status, priority, assignee, project, title, description | `updateIssue()` |
| `get_task` | Get full details on a specific task by ID or identifier | fetch by ID |
| `get_suggested_tasks` | Read pending suggested tasks from triage | query `suggestedTasks` table |

These are thin wrappers around existing Linear API functions in `src/lib/linear/issues.ts`. The Linear client code doesn't change.

### Suggested Tasks → Linear Flow

```
Granola call / Email / Slack
    ↓
Triage extracts suggested task
  (assignee: "James", assigneeType: "other")
    ↓
Agent sees via get_suggested_tasks tool
    ↓
Agent matches "James" → Linear team member "James Henderson"
    ↓
Agent proposes: "Create 'Send Q3 budget' and assign to James Henderson?"
    ↓
User confirms → agent calls create_task with assigneeId
```

### Memory Integration

Memory works through existing Supermemory — no special per-capability memory configuration:

- **capability.md** holds explicit defaults and rules (the knobs you turn)
- **Supermemory** holds learned context from conversations (implicit preferences, project knowledge, people context)
- The agent queries Supermemory naturally when it needs context for task decisions
- Conversation-based memory extraction continues to work as-is

### Migration: Config Tools → Capability

The existing 3 config tools (`list_configs`, `read_config`, `propose_config_change`) move into `capabilities/config/`. This ensures everything follows the same pattern. The config capability also gains the ability to modify capability.md files via the existing approval workflow.

### What This Design Does NOT Include (Yet)

- **Heartbeat hooks** — capabilities will be able to register autonomous behaviors (daily check-in, overdue task alerts, suggested task surfacing). Designed for but not built in v1.
- **Reminders / scheduled events** — a `scheduled_events` table for time-specific agent wake-ups. Future capability.
- **Notification delivery** — Telegram push for proactive messages. Future work.
- **Lazy capability loading** — all capability docs are included eagerly in the system prompt. Switch to lazy loading if we exceed ~10 capabilities.

### Future Capabilities (Illustrative)

To show how the pattern scales:

```
capabilities/reminders/     → scheduled_events table + cron tool
capabilities/web-search/    → web search + summarize tools
capabilities/code-session/  → spawn Claude Code session tool
capabilities/email/         → draft/send email tools (wrapping Gmail)
```

Each one: a folder, a capability.md, a tools.ts, an index.ts. Same pattern every time.

## Implementation Sequence

1. **Scaffold the capability system** — types, discovery, index.ts
2. **Migrate config tools** into `capabilities/config/`
3. **Wire into chat** — `getAllTools()` + `getCapabilityPrompts()` into `chatStreamWithTools()` and `buildAgentContext()`
4. **Build tasks capability** — tools wrapping Linear API + capability.md
5. **Add `get_suggested_tasks`** — query suggested tasks table, include in tasks tools
6. **Test across all chat surfaces** — main chat, triage chat, Telegram
7. **Extend config approval** to support capability.md files
