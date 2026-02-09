import type { Capability, ToolDefinition, ToolResult } from '../types';
import { nanoid } from 'nanoid';
import { slugifyTask } from './prompts';
import { getActiveSessions } from '@/lib/action-cards/handlers/code';
import { getCardsByPattern } from '@/lib/action-cards/db';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs', 'code-sessions');

// ---------------------------------------------------------------------------
// Prompt — injected into the agent system prompt
// ---------------------------------------------------------------------------

const PROMPT = `# Code Execution

You can start coding sessions on the Aurelius HQ codebase using start_coding_session.
Use this when the user asks you to fix bugs, add features, refactor code, run tests,
or do any development work on Aurelius itself. Also use when a Linear issue describes
code work that can be acted on.

You can also check on coding session status using check_coding_sessions. Use this when:
- The user asks about running or recent sessions
- You need to report on session progress or results
- The user asks "what's the coding agent doing?"
- The user wants to approve, reject, or review code changes
- The user asks about pending actions or approvals
- The user says anything about merging, reviewing, or managing sessions
In Telegram, calling this tool automatically surfaces interactive cards with buttons.

## When to start a session

- User says "fix the TypeScript errors"
- User says "add a loading spinner to the triage page"
- A triaged Linear issue describes a code change
- You notice something in the codebase that could be improved

## How it works

1. You call start_coding_session with a task description
2. An Action Card appears for the user to review and approve
3. On approval, a Claude Code session runs in an isolated git worktree
4. The session may ask questions — these appear in the web UI and Telegram
5. When complete, a result card shows the diff for approve/reject
6. On approve, changes are merged to main

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
  {
    name: 'check_coding_sessions',
    description:
      'Check the status of coding sessions and surface pending approvals. Use this when the user asks about sessions, wants to approve/reject code, check status, see what\'s pending, or interact with any coding session. In Telegram, calling this tool automatically sends interactive cards with approve/reject/resume buttons.',
    parameters: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Optional: get log tail for a specific session ID',
        },
        log_lines: {
          type: 'number',
          description: 'Number of recent log lines to return (default 30)',
        },
      },
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
  if (toolName === 'start_coding_session') {
    return handleStartSession(toolInput);
  }
  if (toolName === 'check_coding_sessions') {
    return handleCheckSessions(toolInput);
  }
  return null;
}

function handleStartSession(toolInput: Record<string, unknown>): ToolResult {
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
        },
      },
      summary: `Prepared coding session: ${truncatedTask}`,
    }),
  };
}

async function handleCheckSessions(toolInput: Record<string, unknown>): Promise<ToolResult> {
  const requestedSessionId = toolInput.session_id as string | undefined;
  const logLineCount = (toolInput.log_lines as number) ?? 30;

  // Active sessions
  const active = getActiveSessions();
  const activeList = Array.from(active.entries()).map(([id, session]) => ({
    sessionId: id,
    state: session.state,
    pid: session.pid,
  }));

  // Recent sessions from DB (last 10 code cards)
  const allCards = await getCardsByPattern('code');
  const recentCards = allCards.slice(0, 10).map((card) => {
    const data = card.data as Record<string, unknown>;
    return {
      cardId: card.id,
      task: (data.task as string)?.slice(0, 100),
      status: card.status,
      state: data.state,
      branch: data.branchName,
      turns: data.totalTurns,
      cost: data.totalCostUsd,
      lastMessage: data.lastMessage ? String(data.lastMessage).slice(0, 200) : undefined,
      createdAt: card.createdAt,
    };
  });

  // Optional: log tail for a specific session
  let logTail: string | undefined;
  if (requestedSessionId) {
    const logPath = path.join(LOG_DIR, `${requestedSessionId}.log`);
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      logTail = lines.slice(-logLineCount).join('\n');
    } else {
      logTail = '(no log file found)';
    }
  }

  return {
    result: JSON.stringify({
      activeSessions: activeList,
      recentSessions: recentCards,
      logTail,
    }, null, 2),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const codeCapability: Capability = {
  name: 'code',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 2,
  handleTool: handleCodeTool,
};
