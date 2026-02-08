import type { Capability, ToolDefinition, ToolResult } from '../types';
import { nanoid } from 'nanoid';
import { slugifyTask } from './prompts';

// ---------------------------------------------------------------------------
// Prompt — injected into the agent system prompt
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'start_coding_session',
    description:
      'Start a Claude Code session to work on the Aurelius HQ codebase. Use when the user asks to fix bugs, add features, refactor code, or do development work. Returns an action card for user approval before the session starts.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the coding task to perform',
        },
        context: {
          type: 'string',
          description:
            'Optional extra context — Linear issue IDs, error messages, file paths',
        },
        branch_name: {
          type: 'string',
          description:
            'Optional branch name override (without aurelius/ prefix)',
        },
      },
      required: ['task'],
    },
  },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCodeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (toolName !== 'start_coding_session') return null;

  const task = String(toolInput.task || '');
  const context = toolInput.context ? String(toolInput.context) : null;
  const branchName =
    'aurelius/' +
    (toolInput.branch_name ? String(toolInput.branch_name) : slugifyTask(task));

  const sessionId = nanoid(12);

  const truncatedTask = task.length > 60 ? task.slice(0, 57) + '...' : task;

  return {
    result: JSON.stringify({
      action_card: {
        pattern: 'code',
        handler: 'code:start',
        title: `Coding: ${truncatedTask}`,
        data: {
          sessionId,
          task,
          context,
          branchName,
          maxTurns: 25,
          timeoutMs: 300000,
        },
      },
      summary: `Prepared coding session: ${truncatedTask}`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const codeCapability: Capability = {
  name: 'code',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleCodeTool,
};
