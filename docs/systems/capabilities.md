# Agent Capabilities System

The capabilities system gives Aurelius modular, self-modifiable skills. Each capability is a self-contained module that provides tools the agent can use during chat, along with instructions that guide how and when to use them.

## Architecture

```
src/lib/capabilities/
├── types.ts           # Capability, ToolDefinition, ToolResult interfaces
├── index.ts           # Registry — collects all capabilities, dispatches tool calls
├── config/            # Configuration capability
│   ├── index.ts       # Prompt + capability export
│   └── tools.ts       # list_configs, read_config, propose_config_change
└── tasks/             # Tasks capability
    ├── index.ts       # Prompt + capability export
    └── tools.ts       # list_tasks, create_task, update_task, get_task, etc.
```

## How It Works

### 1. Registration

All capabilities are registered in `src/lib/capabilities/index.ts`:

```typescript
const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
];
```

The registry exposes three functions:
- **`getAllTools()`** — returns all tool definitions (OpenAI function calling format) for the LLM
- **`getCapabilityPrompts()`** — loads each capability's prompt from the DB for inclusion in the system prompt
- **`handleToolCall()`** — dispatches a tool call to the correct capability handler

### 2. Tool Execution Flow

```
User message → AI model → tool_call (e.g. "create_task")
                                ↓
                        handleToolCall()
                                ↓
                  Loop through ALL_CAPABILITIES
                  Each handler returns null if not its tool
                                ↓
                  Matching handler executes and returns result
                                ↓
                        AI model receives result
                        Continues conversation or calls another tool
```

### 3. Prompt Loading (DB is source of truth)

Capability prompts are stored in the database under config keys like `capability:tasks`. On first access, the hardcoded default is seeded into the DB as v1. After that, the DB version is always used.

```
getCapabilityPrompts() called during buildAgentContext()
    ↓
For each capability, read from DB (key: "capability:<name>")
    ↓
If no DB entry → seed hardcoded default as v1 → return it
If DB entry exists → return DB content
    ↓
All prompts assembled into system prompt under "## Available Capabilities"
```

### 4. Self-Modification

The agent can modify its own capability prompts through the config tools:

1. Agent calls `read_config` with key `capability:tasks` → slide-out panel shows current prompt
2. Agent calls `propose_config_change` with updated content + reason
3. Slide-out diff panel opens showing additions/removals
4. User approves or rejects
5. If approved, DB is updated → next chat uses the new prompt

This means the agent's behavior evolves through conversation. Users can say things like "always put my personal tasks in the Personal team" and the agent will propose updating its own instructions.

## Capability Interface

Every capability implements this interface:

```typescript
interface Capability {
  name: string;           // Unique identifier (e.g. "tasks")
  tools: ToolDefinition[];  // Tool definitions for the LLM
  prompt: string;           // Default instructions (seeded to DB on first use)
  handleTool: (
    toolName: string,
    toolInput: Record<string, unknown>,
    conversationId?: string
  ) => Promise<ToolResult | null>;  // null = not my tool
}
```

Key design decisions:
- **Handlers return `null`** for unrecognized tool names, enabling chain-of-responsibility dispatch
- **`conversationId`** is passed through for tools that need it (e.g. linking pending changes to conversations)
- **`ToolResult.pendingChangeId`** triggers the diff panel in the UI when present

## Adding a New Capability

### Step 1: Create the folder

```
src/lib/capabilities/<name>/
├── index.ts    # Prompt + capability export
└── tools.ts    # Tool definitions + handler
```

### Step 2: Define tools (`tools.ts`)

```typescript
import type { ToolDefinition, ToolResult } from "../types";

export const MY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "my_tool",
    description: "What this tool does — be specific so the LLM knows when to use it",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "..." },
      },
      required: ["param1"],
    },
  },
];

export async function handleMyTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  _conversationId?: string,
): Promise<ToolResult | null> {
  switch (toolName) {
    case "my_tool": {
      // Implementation here
      return { result: JSON.stringify({ success: true }) };
    }
    default:
      return null; // Not my tool — let another capability handle it
  }
}
```

### Step 3: Create the capability (`index.ts`)

```typescript
import type { Capability } from '../types';
import { MY_TOOL_DEFINITIONS, handleMyTool } from './tools';

const PROMPT = `# My Capability

Instructions for the agent on when and how to use these tools.
This is the default prompt — seeded to DB on first use.
The agent (or user) can modify it later via the config system.`;

export const myCapability: Capability = {
  name: 'my-capability',
  tools: MY_TOOL_DEFINITIONS,
  prompt: PROMPT,
  handleTool: handleMyTool,
};
```

### Step 4: Register it

In `src/lib/capabilities/index.ts`:

```typescript
import { myCapability } from './my-capability';

const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
  myCapability,  // Add here
];
```

### Step 5: Add the config key

In `src/lib/db/schema/config.ts`, add the new key to `configKeyEnum`:

```typescript
export const configKeyEnum = pgEnum("config_key", [
  "soul",
  "system_prompt",
  "agents",
  "processes",
  "capability:tasks",
  "capability:config",
  "capability:my-capability",  // Add here
]);
```

Then create a migration:

```bash
bunx drizzle-kit generate
bunx drizzle-kit push
```

And add a description in `src/lib/config.ts`:

```typescript
export const CONFIG_DESCRIPTIONS: Record<ConfigKey, string> = {
  // ...existing entries
  "capability:my-capability": "Instructions for My Capability.",
};
```

### Step 6: Test

1. Start the dev server
2. Open chat and send a message — this triggers `getCapabilityPrompts()` which seeds the default
3. Ask the agent to use the new tool
4. Ask the agent to "show me your my-capability config" — verify the prompt appears

## Current Capabilities

### Config (`capability:config`)

**Purpose:** Lets the agent read and modify its own configuration.

**Tools:**
| Tool | Description |
|------|-------------|
| `list_configs` | List all config keys and their descriptions |
| `read_config` | Read current content of a config (opens slide-out panel) |
| `propose_config_change` | Propose a change for user approval (opens diff panel) |

### Tasks (`capability:tasks`)

**Purpose:** Manages tasks via Linear. Creates, updates, lists, and inspects issues.

**Tools:**
| Tool | Description |
|------|-------------|
| `list_tasks` | List all active tasks assigned to the owner |
| `create_task` | Create a new task (looks up team, project, assignee by name) |
| `update_task` | Update status, assignee, project, priority, etc. |
| `get_task` | Get full details of a task by ID or identifier (e.g. PER-123) |
| `get_team_context` | Get workspace info: teams, projects, members |
| `get_suggested_tasks` | Get suggested tasks from triage (meetings, emails) |

**Authentication:**
- OAuth client credentials grant → acts as "Mark's Agent" in Linear
- `LINEAR_OWNER_USER_ID` → tasks are assigned to the human owner
- Has read/write access to all public teams + configured private teams

## Integration Points

### Where capabilities plug in

| Integration | File | How |
|-------------|------|-----|
| Chat API | `lib/ai/client.ts` | `getAllTools()` provides tools to `chatStreamWithTools()` |
| System prompt | `lib/ai/context.ts` | `getCapabilityPrompts()` added in `buildAgentContext()` |
| Tool dispatch | `lib/ai/client.ts` | `handleToolCall()` processes tool_use events |
| UI (diff panel) | `app/chat/chat-client.tsx` | `pendingChangeId` triggers right sidebar |
| Config storage | `lib/config.ts` | Capability prompts stored as `capability:<name>` keys |

### All chat surfaces get capabilities

All chat surfaces (web chat, triage modal, Cmd+K panel, Telegram) use `buildAgentContext()` → `chatStreamWithTools()`, so capabilities are available everywhere the agent operates. See [Unified Chat](./unified-chat.md) for the full architecture.
