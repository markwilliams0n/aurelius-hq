# Agent Capabilities System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an extensible capability system for the Aurelius agent, with Tasks as the first capability — enabling the agent to manage Linear tasks across all chat surfaces.

**Architecture:** Capabilities are self-contained folders under `src/lib/capabilities/` with tools (TypeScript), prompts (capability.md), and a barrel export. The system auto-collects all capabilities and wires them into `chatStreamWithTools()` and `buildAgentContext()`. Existing config tools are migrated into this pattern.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM, Linear GraphQL API, OpenRouter (OpenAI function calling format)

---

### Task 1: Capability Types and Discovery

**Files:**
- Create: `src/lib/capabilities/types.ts`
- Create: `src/lib/capabilities/index.ts`

**Step 1: Create the capability type definitions**

Create `src/lib/capabilities/types.ts`:

```typescript
/**
 * Agent Capability System
 *
 * Each capability is a self-contained module that provides:
 * - Tools: Functions the LLM can call during chat
 * - Prompt: Instructions for the agent (from capability.md)
 * - Handler: Dispatches tool calls to the right function
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  result: string;
  pendingChangeId?: string;
}

export interface Capability {
  /** Unique name for this capability */
  name: string;
  /** Tool definitions (OpenAI function calling format) */
  tools: ToolDefinition[];
  /** Agent instructions from capability.md */
  prompt: string;
  /** Handle a tool call — return null if tool name not recognized */
  handleTool: (
    toolName: string,
    toolInput: Record<string, unknown>,
    conversationId?: string
  ) => Promise<ToolResult | null>;
}
```

**Step 2: Create the capability registry**

Create `src/lib/capabilities/index.ts`:

```typescript
/**
 * Capability Registry
 *
 * Auto-collects all capabilities and provides:
 * - getAllTools(): all tool definitions for the LLM
 * - getCapabilityPrompts(): all capability.md contents for the system prompt
 * - handleToolCall(): dispatches a tool call to the right capability
 */

import type { Capability, ToolDefinition, ToolResult } from './types';

// Import capabilities — add new ones here
import { configCapability } from './config';
import { tasksCapability } from './tasks';

const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
];

/** Get all tool definitions from all capabilities */
export function getAllTools(): { type: "function"; function: ToolDefinition }[] {
  return ALL_CAPABILITIES.flatMap(cap =>
    cap.tools.map(t => ({ type: "function" as const, function: t }))
  );
}

/** Get formatted capability prompts for the system prompt */
export function getCapabilityPrompts(): string {
  const sections = ALL_CAPABILITIES
    .filter(cap => cap.prompt.trim().length > 0)
    .map(cap => cap.prompt);

  if (sections.length === 0) return '';
  return `## Available Capabilities\n\n${sections.join('\n\n---\n\n')}`;
}

/** Dispatch a tool call to the right capability handler */
export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult> {
  for (const cap of ALL_CAPABILITIES) {
    const result = await cap.handleTool(toolName, toolInput, conversationId);
    if (result !== null) return result;
  }
  return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
}

export type { Capability, ToolDefinition, ToolResult };
```

**Step 3: Commit**

```
feat: add capability system types and registry
```

---

### Task 2: Migrate Config Tools to Capability

**Files:**
- Create: `src/lib/capabilities/config/index.ts`
- Create: `src/lib/capabilities/config/tools.ts`
- Create: `src/lib/capabilities/config/capability.md`
- Modify: `src/lib/ai/config-tools.ts` (keep for now, re-export from capability)

**Step 1: Create config capability.md**

Create `src/lib/capabilities/config/capability.md`:

```markdown
# Configuration

You can read and modify your own configuration using tools.

## When to use

- When the user asks you to change your behavior, personality, or prompts
- When the user wants to see your current configuration
- When you want to propose changes to capability instructions

## How it works

- Changes are NOT applied immediately — they create a pending change
- The user must explicitly approve changes before they take effect
- Always read the current config before proposing changes
- Explain clearly what you're changing and why

## Available configs

- **soul** — Your personality and behavioral instructions
- **system_prompt** — Core system prompt defining your capabilities
- **agents** — Specialized sub-agent configurations (reserved)
- **processes** — Automated process definitions (reserved)
- **capability:*** — Capability instruction files (e.g. capability:tasks)
```

**Step 2: Create config tools module**

Create `src/lib/capabilities/config/tools.ts` — move the tool definitions and handler from `src/lib/ai/config-tools.ts`:

```typescript
import { getConfig, getAllConfigs, proposePendingChange, CONFIG_DESCRIPTIONS, type ConfigKey } from "@/lib/config";
import { configKeyEnum } from "@/lib/db/schema";
import type { ToolDefinition, ToolResult } from "../types";

export const CONFIG_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_configs",
    description: "List all available configuration keys and their descriptions. Use this to see what configs can be modified.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "read_config",
    description: "Read the current content of a specific configuration. Use this to see the current state before proposing changes.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The configuration key to read",
          enum: configKeyEnum.enumValues,
        },
      },
      required: ["key"],
    },
  },
  {
    name: "propose_config_change",
    description: "Propose a change to a configuration. This will NOT apply immediately - it creates a pending change that the user must approve. Always explain what you're changing and why.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The configuration key to modify",
          enum: configKeyEnum.enumValues,
        },
        proposedContent: {
          type: "string",
          description: "The complete new content for this configuration",
        },
        reason: {
          type: "string",
          description: "A clear explanation of what is being changed and why",
        },
      },
      required: ["key", "proposedContent", "reason"],
    },
  },
];

function isValidConfigKey(key: unknown): key is ConfigKey {
  return typeof key === "string" && key !== "" && configKeyEnum.enumValues.includes(key as ConfigKey);
}

export async function handleConfigTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult | null> {
  switch (toolName) {
    case "list_configs": {
      const configs = await getAllConfigs();
      const configList = configKeyEnum.enumValues.map((key) => {
        const current = configs.find((c) => c.key === key);
        return {
          key,
          description: CONFIG_DESCRIPTIONS[key],
          hasContent: !!current,
          version: current?.version ?? 0,
          lastUpdated: current?.createdAt ?? null,
        };
      });

      return {
        result: JSON.stringify({
          configs: configList,
          note: "Use read_config to see the full content of any configuration.",
        }, null, 2),
      };
    }

    case "read_config": {
      const key = toolInput.key;

      if (!key || typeof key !== "string" || key === "") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: key. Please specify which configuration to read.",
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      if (!isValidConfigKey(key)) {
        return {
          result: JSON.stringify({
            error: `Invalid config key: "${key}". Valid keys are: ${configKeyEnum.enumValues.join(", ")}`,
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      const config = await getConfig(key);

      if (!config) {
        return {
          result: JSON.stringify({
            key,
            description: CONFIG_DESCRIPTIONS[key],
            content: null,
            note: "This configuration has not been set yet. You can propose initial content using propose_config_change.",
          }, null, 2),
        };
      }

      return {
        result: JSON.stringify({
          key: config.key,
          description: CONFIG_DESCRIPTIONS[key],
          content: config.content,
          version: config.version,
          createdBy: config.createdBy,
          createdAt: config.createdAt,
        }, null, 2),
      };
    }

    case "propose_config_change": {
      console.log("[Config Tool] propose_config_change called with:", JSON.stringify(toolInput, null, 2));
      const key = toolInput.key;
      const proposedContent = toolInput.proposedContent;
      const reason = toolInput.reason;

      if (!key || typeof key !== "string" || key === "") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: key. Please specify which configuration to modify.",
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      if (!isValidConfigKey(key)) {
        return {
          result: JSON.stringify({
            error: `Invalid config key: "${key}". Valid keys are: ${configKeyEnum.enumValues.join(", ")}`,
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      if (!proposedContent || typeof proposedContent !== "string") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: proposedContent. Please provide the new content for the configuration.",
          }),
        };
      }

      if (!reason || typeof reason !== "string") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: reason. Please explain why this change is being made.",
          }),
        };
      }

      const pending = await proposePendingChange(key, proposedContent as string, reason as string, conversationId);
      console.log("[Config Tool] Pending change created:", pending.id);

      return {
        result: JSON.stringify({
          success: true,
          pendingChangeId: pending.id,
          message: `I've proposed a change to the "${key}" configuration. The change is now pending your approval.`,
          key,
          reason,
        }, null, 2),
        pendingChangeId: pending.id,
      };
    }

    default:
      return null; // Not a config tool
  }
}
```

**Step 3: Create config capability barrel export**

Create `src/lib/capabilities/config/index.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Capability } from '../types';
import { CONFIG_TOOL_DEFINITIONS, handleConfigTool } from './tools';

const prompt = readFileSync(
  join(__dirname, 'capability.md'),
  'utf-8'
);

export const configCapability: Capability = {
  name: 'config',
  tools: CONFIG_TOOL_DEFINITIONS,
  prompt,
  handleTool: handleConfigTool,
};
```

**Step 4: Commit**

```
refactor: migrate config tools into capability system
```

---

### Task 3: Wire Capabilities into AI Client

**Files:**
- Modify: `src/lib/ai/client.ts` — replace hardcoded CONFIG_TOOLS with capability system
- Modify: `src/lib/ai/context.ts` — add capability prompts to system prompt
- Modify: `src/lib/ai/prompts.ts` — remove hardcoded config tool docs from system prompt

**Step 1: Update client.ts to use capability system**

In `src/lib/ai/client.ts`:

Replace the import:
```typescript
// OLD
import { CONFIG_TOOLS, handleConfigTool } from "./config-tools";
// NEW
import { getAllTools, handleToolCall } from "@/lib/capabilities";
```

In `chatStreamWithTools()`, replace the tools in the API call:
```typescript
// OLD
tools: CONFIG_TOOLS.map(t => ({
  type: "function",
  function: t,
})),
// NEW
tools: getAllTools(),
```

Replace the tool dispatch:
```typescript
// OLD
const { result: toolResult, pendingChangeId } = await handleConfigTool(
  toolName,
  parsedArgs,
  conversationId
);
// NEW
const { result: toolResult, pendingChangeId } = await handleToolCall(
  toolName,
  parsedArgs,
  conversationId
);
```

**Step 2: Update context.ts to include capability prompts**

In `src/lib/ai/context.ts`, add import and include capability prompts:

```typescript
import { getCapabilityPrompts } from '@/lib/capabilities';
```

In `buildAgentContext()`, after building the system prompt:
```typescript
// Add capability prompts
const capabilityPrompts = getCapabilityPrompts();
if (capabilityPrompts) {
  systemPrompt += `\n\n${capabilityPrompts}`;
}
```

**Step 3: Remove hardcoded config tool docs from prompts.ts**

In `src/lib/ai/prompts.ts`, remove the `## Configuration Tools` section from `getChatSystemPrompt()` (lines ~42-64). This is now handled by `capabilities/config/capability.md`.

**Step 4: Fix triage chat to use tools**

In `src/app/api/triage/chat/route.ts`, the triage chat currently uses `chat()` (no tools). Update it to use `chatStreamWithTools()` so it gets capability tools too. This is a bigger change — for now, at minimum ensure the capability prompts are in the system prompt so the triage chat is at least aware of capabilities even if it can't call tools yet.

**Step 5: Verify the app builds**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run build
```

**Step 6: Commit**

```
feat: wire capability system into AI client and context
```

---

### Task 4: Handle capability.md File Loading

**Problem:** `readFileSync` with `__dirname` won't work with Next.js bundling. We need a reliable way to load capability.md files.

**Files:**
- Modify: `src/lib/capabilities/config/index.ts`
- Modify: `src/lib/capabilities/index.ts`

**Step 1: Use inline prompt strings instead of file reads**

Since Next.js bundles server code, reading files relative to `__dirname` is unreliable. Instead, each capability exports its prompt as a string constant. The capability.md files still exist as the "source of truth" for documentation, but the actual prompt loaded at runtime is the exported string.

Update `src/lib/capabilities/config/index.ts`:

```typescript
import type { Capability } from '../types';
import { CONFIG_TOOL_DEFINITIONS, handleConfigTool } from './tools';

// Prompt loaded from capability.md content — edit capability.md and sync here
const PROMPT = `# Configuration

You can read and modify your own configuration using tools.

## When to use

- When the user asks you to change your behavior, personality, or prompts
- When the user wants to see your current configuration
- When you want to propose changes to capability instructions

## How it works

- Changes are NOT applied immediately — they create a pending change
- The user must explicitly approve changes before they take effect
- Always read the current config before proposing changes
- Explain clearly what you're changing and why

## Available configs

- **soul** — Your personality and behavioral instructions
- **system_prompt** — Core system prompt defining your capabilities
- **agents** — Specialized sub-agent configurations (reserved)
- **processes** — Automated process definitions (reserved)`;

export const configCapability: Capability = {
  name: 'config',
  tools: CONFIG_TOOL_DEFINITIONS,
  prompt: PROMPT,
  handleTool: handleConfigTool,
};
```

**Alternative approach — if we want runtime-editable prompts:** Store capability prompts in the `configs` DB table with keys like `capability:tasks`, `capability:config`. This enables the agent to modify them via the existing `propose_config_change` tool. The capability modules would load their prompts from the DB at request time with a fallback to the hardcoded default.

**Decision:** Start with hardcoded strings (simple, works). In Task 7 we add DB-backed prompts so the agent can self-modify.

**Step 2: Commit**

```
fix: use inline prompt strings for capability loading
```

---

### Task 5: Build Tasks Capability

**Files:**
- Create: `src/lib/capabilities/tasks/tools.ts`
- Create: `src/lib/capabilities/tasks/index.ts`
- Create: `src/lib/capabilities/tasks/capability.md`
- Modify: `src/lib/capabilities/index.ts` (add tasks import)

**Step 1: Create tasks capability.md**

Create `src/lib/capabilities/tasks/capability.md`:

```markdown
# Tasks

You can manage tasks via Linear. You have tools for creating, updating,
listing, and inspecting tasks, as well as reviewing suggested tasks from triage.

## When to use

- When the user mentions something they need to do, offer to create a task
- When asked about priorities or what to work on, list current tasks and help sequence them
- When you see suggested tasks from triage (meetings, emails), propose creating them in Linear
- Reference tasks by their identifier (e.g. PER-123) when discussing them

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

When discussing tasks, use memory to recall relevant context about projects,
people, and preferences. Defaults above are the baseline; learned preferences
from conversation history take precedence.
```

**Step 2: Create tasks tools**

Create `src/lib/capabilities/tasks/tools.ts`:

```typescript
import {
  fetchAllMyTasks,
  fetchViewerContext,
  fetchTeamMembers,
  fetchWorkflowStates,
  createIssue,
  updateIssue,
} from '@/lib/linear/issues';
import { db } from '@/lib/db';
import { suggestedTasks } from '@/lib/db/schema/tasks';
import { eq } from 'drizzle-orm';
import type { ToolDefinition, ToolResult } from '../types';

export const TASK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_tasks",
    description: "List your current tasks from Linear. Returns active tasks (not completed/canceled) assigned to you. Use this to see what's on your plate, help prioritize, or find specific tasks.",
    parameters: {
      type: "object",
      properties: {
        includeCompleted: {
          type: "boolean",
          description: "Include completed/canceled tasks (default: false)",
        },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task in Linear. Always confirm with the user before creating. The default team is 'Personal' unless the user specifies otherwise.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Task title — clear and actionable",
        },
        description: {
          type: "string",
          description: "Optional task description with context",
        },
        teamName: {
          type: "string",
          description: "Team name (default: 'Personal'). Use list_tasks first to see available teams.",
        },
        projectName: {
          type: "string",
          description: "Optional project name to add the task to",
        },
        assigneeName: {
          type: "string",
          description: "Optional assignee name. Use get_team_context to look up team members.",
        },
        priority: {
          type: "number",
          description: "Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task in Linear. Can change status, priority, assignee, project, title, or description.",
    parameters: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "The Linear issue ID to update",
        },
        statusName: {
          type: "string",
          description: "New status name (e.g. 'In Progress', 'Done', 'Todo')",
        },
        assigneeName: {
          type: "string",
          description: "New assignee name, or 'none' to unassign",
        },
        projectName: {
          type: "string",
          description: "New project name, or 'none' to remove from project",
        },
        priority: {
          type: "number",
          description: "New priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low",
        },
        title: {
          type: "string",
          description: "New title",
        },
        description: {
          type: "string",
          description: "New description",
        },
      },
      required: ["issueId"],
    },
  },
  {
    name: "get_team_context",
    description: "Get your Linear workspace context: teams, projects, and team members. Use this to look up team/project/member IDs before creating or updating tasks.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_suggested_tasks",
    description: "Get pending suggested tasks from triage. These are tasks extracted from meetings, emails, and messages that haven't been acted on yet. Review these to help the user decide which to create in Linear.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status: 'suggested' (default), 'accepted', 'dismissed', or 'all'",
          enum: ["suggested", "accepted", "dismissed", "all"],
        },
      },
    },
  },
];

export async function handleTaskTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  _conversationId?: string
): Promise<ToolResult | null> {
  switch (toolName) {
    case "list_tasks": {
      try {
        const { issues, context } = await fetchAllMyTasks();

        const taskSummary = issues.map(issue => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state?.name,
          statusType: issue.state?.type,
          priority: issue.priority,
          priorityLabel: ['None', 'Urgent', 'High', 'Normal', 'Low'][issue.priority] || 'None',
          project: issue.project?.name || null,
          team: issue.team?.name || null,
          assignee: issue.assignee?.name || null,
          dueDate: issue.dueDate || null,
          url: issue.url,
        }));

        return {
          result: JSON.stringify({
            tasks: taskSummary,
            count: taskSummary.length,
            teams: context.teams.map(t => t.name),
            projects: context.projects.map(p => p.name),
          }, null, 2),
        };
      } catch (error) {
        return { result: JSON.stringify({ error: `Failed to fetch tasks: ${error}` }) };
      }
    }

    case "create_task": {
      try {
        const title = toolInput.title as string;
        if (!title) {
          return { result: JSON.stringify({ error: "title is required" }) };
        }

        // Look up team, project, and assignee by name
        const context = await fetchViewerContext();
        const teamName = (toolInput.teamName as string) || 'Personal';
        const team = context.teams.find(t =>
          t.name.toLowerCase() === teamName.toLowerCase()
        );

        if (!team) {
          return {
            result: JSON.stringify({
              error: `Team "${teamName}" not found. Available teams: ${context.teams.map(t => t.name).join(', ')}`,
            }),
          };
        }

        const input: Parameters<typeof createIssue>[0] = {
          title,
          teamId: team.id,
        };

        if (toolInput.description) {
          input.description = toolInput.description as string;
        }

        if (toolInput.priority !== undefined) {
          input.priority = toolInput.priority as number;
        }

        // Look up project by name
        if (toolInput.projectName) {
          const project = context.projects.find(p =>
            p.name.toLowerCase() === (toolInput.projectName as string).toLowerCase()
          );
          if (project) {
            input.projectId = project.id;
          }
        }

        // Look up assignee by name
        if (toolInput.assigneeName) {
          const members = await fetchTeamMembers();
          const member = members.find(m =>
            m.name.toLowerCase().includes((toolInput.assigneeName as string).toLowerCase())
          );
          if (member) {
            input.assigneeId = member.id;
          }
        }

        const result = await createIssue(input);

        if (result.success && result.issue) {
          return {
            result: JSON.stringify({
              success: true,
              task: {
                id: result.issue.id,
                identifier: result.issue.identifier,
                title: result.issue.title,
                team: result.issue.team?.name,
                project: result.issue.project?.name,
                assignee: result.issue.assignee?.name,
                url: result.issue.url,
              },
            }, null, 2),
          };
        }

        return { result: JSON.stringify({ error: "Failed to create task", details: result }) };
      } catch (error) {
        return { result: JSON.stringify({ error: `Failed to create task: ${error}` }) };
      }
    }

    case "update_task": {
      try {
        const issueId = toolInput.issueId as string;
        if (!issueId) {
          return { result: JSON.stringify({ error: "issueId is required" }) };
        }

        const updates: Parameters<typeof updateIssue>[1] = {};

        // Look up status by name
        if (toolInput.statusName) {
          const states = await fetchWorkflowStates();
          const state = states.find(s =>
            s.name.toLowerCase() === (toolInput.statusName as string).toLowerCase()
          );
          if (state) {
            updates.stateId = state.id;
          } else {
            return {
              result: JSON.stringify({
                error: `Status "${toolInput.statusName}" not found. Available: ${states.map(s => s.name).join(', ')}`,
              }),
            };
          }
        }

        // Look up assignee by name
        if (toolInput.assigneeName) {
          if (toolInput.assigneeName === 'none') {
            updates.assigneeId = null;
          } else {
            const members = await fetchTeamMembers();
            const member = members.find(m =>
              m.name.toLowerCase().includes((toolInput.assigneeName as string).toLowerCase())
            );
            if (member) {
              updates.assigneeId = member.id;
            }
          }
        }

        // Look up project by name
        if (toolInput.projectName) {
          if (toolInput.projectName === 'none') {
            updates.projectId = null;
          } else {
            const context = await fetchViewerContext();
            const project = context.projects.find(p =>
              p.name.toLowerCase() === (toolInput.projectName as string).toLowerCase()
            );
            if (project) {
              updates.projectId = project.id;
            }
          }
        }

        if (toolInput.priority !== undefined) updates.priority = toolInput.priority as number;
        if (toolInput.title) updates.title = toolInput.title as string;
        if (toolInput.description) updates.description = toolInput.description as string;

        const result = await updateIssue(issueId, updates);

        if (result.success && result.issue) {
          return {
            result: JSON.stringify({
              success: true,
              task: {
                id: result.issue.id,
                identifier: result.issue.identifier,
                title: result.issue.title,
                status: result.issue.state?.name,
                assignee: result.issue.assignee?.name,
                project: result.issue.project?.name,
                url: result.issue.url,
              },
            }, null, 2),
          };
        }

        return { result: JSON.stringify({ error: "Failed to update task", details: result }) };
      } catch (error) {
        return { result: JSON.stringify({ error: `Failed to update task: ${error}` }) };
      }
    }

    case "get_team_context": {
      try {
        const [context, members] = await Promise.all([
          fetchViewerContext(),
          fetchTeamMembers(),
        ]);

        return {
          result: JSON.stringify({
            viewer: context.viewer,
            teams: context.teams,
            projects: context.projects,
            members: members.map(m => ({ id: m.id, name: m.name, email: m.email })),
          }, null, 2),
        };
      } catch (error) {
        return { result: JSON.stringify({ error: `Failed to fetch context: ${error}` }) };
      }
    }

    case "get_suggested_tasks": {
      try {
        const statusFilter = (toolInput.status as string) || 'suggested';

        let query = db.select().from(suggestedTasks);
        if (statusFilter !== 'all') {
          query = query.where(eq(suggestedTasks.status, statusFilter as 'suggested' | 'accepted' | 'dismissed'));
        }

        const tasks = await query;

        return {
          result: JSON.stringify({
            suggestedTasks: tasks.map(t => ({
              id: t.id,
              description: t.description,
              assignee: t.assignee,
              assigneeType: t.assigneeType,
              dueDate: t.dueDate,
              status: t.status,
              confidence: t.confidence,
              extractedAt: t.extractedAt,
              sourceItemId: t.sourceItemId,
            })),
            count: tasks.length,
          }, null, 2),
        };
      } catch (error) {
        return { result: JSON.stringify({ error: `Failed to fetch suggested tasks: ${error}` }) };
      }
    }

    default:
      return null; // Not a task tool
  }
}
```

**Step 3: Create tasks capability barrel export**

Create `src/lib/capabilities/tasks/index.ts`:

```typescript
import type { Capability } from '../types';
import { TASK_TOOL_DEFINITIONS, handleTaskTool } from './tools';

const PROMPT = `# Tasks

You can manage tasks via Linear. You have tools for creating, updating,
listing, and inspecting tasks, as well as reviewing suggested tasks from triage.

## When to use

- When the user mentions something they need to do, offer to create a task
- When asked about priorities or what to work on, list current tasks and help sequence them
- When you see suggested tasks from triage (meetings, emails), propose creating them in Linear
- Reference tasks by their identifier (e.g. PER-123) when discussing them

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

When discussing tasks, use memory to recall relevant context about projects,
people, and preferences. Defaults above are the baseline; learned preferences
from conversation history take precedence.`;

export const tasksCapability: Capability = {
  name: 'tasks',
  tools: TASK_TOOL_DEFINITIONS,
  prompt: PROMPT,
  handleTool: handleTaskTool,
};
```

**Step 4: Verify build**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run build
```

**Step 5: Commit**

```
feat: add tasks capability with Linear integration
```

---

### Task 6: Add DB-Backed Capability Prompts (Agent Self-Modification)

**Files:**
- Modify: `src/lib/db/schema/config.ts` — add capability config keys
- Modify: `src/lib/config.ts` — add capability key descriptions
- Modify: `src/lib/capabilities/index.ts` — load prompts from DB with fallback
- Run: database migration

**Step 1: Add capability config keys to the enum**

This requires a DB migration. Add `capability:tasks` and `capability:config` to the `configKeyEnum`.

In `src/lib/db/schema/config.ts`, update:
```typescript
export const configKeyEnum = pgEnum("config_key", [
  "soul",
  "system_prompt",
  "agents",
  "processes",
  "capability:tasks",
  "capability:config",
]);
```

**Step 2: Add descriptions in config.ts**

In `src/lib/config.ts`, add to `CONFIG_DESCRIPTIONS`:
```typescript
"capability:tasks": "Instructions for the Tasks capability — how the agent manages tasks via Linear.",
"capability:config": "Instructions for the Configuration capability — how the agent manages its own config.",
```

**Step 3: Update capability loading to check DB first**

In `src/lib/capabilities/index.ts`, add a function that loads prompts from DB with fallback to hardcoded:

```typescript
import { getConfig } from '@/lib/config';

/** Load a capability prompt, checking DB first (for agent-modified versions), falling back to default */
async function loadCapabilityPrompt(capabilityName: string, defaultPrompt: string): Promise<string> {
  try {
    const configKey = `capability:${capabilityName}`;
    const config = await getConfig(configKey as any);
    if (config?.content) return config.content;
  } catch {
    // DB not available or key doesn't exist — use default
  }
  return defaultPrompt;
}
```

Update `getCapabilityPrompts()` to be async and load from DB:

```typescript
export async function getCapabilityPrompts(): Promise<string> {
  const sections = await Promise.all(
    ALL_CAPABILITIES.map(async cap => {
      const prompt = await loadCapabilityPrompt(cap.name, cap.prompt);
      return prompt.trim();
    })
  );

  const nonEmpty = sections.filter(s => s.length > 0);
  if (nonEmpty.length === 0) return '';
  return `## Available Capabilities\n\n${nonEmpty.join('\n\n---\n\n')}`;
}
```

**Step 4: Run migration**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bunx drizzle-kit generate && bunx drizzle-kit push
```

**Step 5: Update context.ts for async capability prompts**

The `getCapabilityPrompts()` call in `buildAgentContext()` is now async — make sure it's awaited (add to the `Promise.all`).

**Step 6: Commit**

```
feat: DB-backed capability prompts with agent self-modification
```

---

### Task 7: Manual Testing Across All Chat Surfaces

**No code changes — verification only.**

**Step 1: Start the dev server**

```bash
cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run dev
```

**Step 2: Test main chat**

Open the web chat and try:
- "What tasks do I have?" → should call `list_tasks`
- "Create a task to review Q3 budget" → should call `create_task` after confirming
- "What are my suggested tasks?" → should call `get_suggested_tasks`
- "What configs are available?" → should still call `list_configs` (config capability works)

**Step 3: Test Telegram**

Send messages via Telegram:
- "List my tasks" → should call `list_tasks` and return formatted results
- "Create a task: prepare meeting notes" → should confirm then create

**Step 4: Test triage chat**

Open a triage item and chat:
- The triage chat should have capability awareness in the system prompt
- Note: triage chat currently uses `chat()` not `chatStreamWithTools()` — tools won't work here yet. This is a known gap to address in a follow-up.

**Step 5: Commit any fixes**

```
fix: address issues found during capability system testing
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Capability types + registry | `capabilities/types.ts`, `capabilities/index.ts` |
| 2 | Migrate config tools | `capabilities/config/` |
| 3 | Wire into AI client + context | `ai/client.ts`, `ai/context.ts`, `ai/prompts.ts` |
| 4 | Fix capability.md loading | `capabilities/config/index.ts` |
| 5 | Tasks capability | `capabilities/tasks/` |
| 6 | DB-backed prompts | `db/schema/config.ts`, `config.ts`, `capabilities/index.ts` |
| 7 | Manual testing | All chat surfaces |
