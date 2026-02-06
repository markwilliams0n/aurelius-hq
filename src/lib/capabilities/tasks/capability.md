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
