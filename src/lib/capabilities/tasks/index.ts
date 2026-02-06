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

- Default team: use get_team_context to check available teams; prefer the user's personal team if available
- Tasks are automatically assigned to the owner (Mark) unless a different assignee is specified
- You (the agent) operate as "Mark's Agent" in Linear — actions you take will show as from the agent account
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
