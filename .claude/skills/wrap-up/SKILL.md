---
name: wrap-up
description: Update worklog with current session progress. Use after completing features, significant commits, switching branches, or ending a session. Triggers on "wrap up", "update worklog", "session end", "what did we do".
---

# Wrap Up

Quick worklog update + Linear sync to maintain session context.

## When to Run

- After `/finish-feature` merges to main
- After significant commits
- When switching back to main from a feature branch
- Before ending a session
- Anytime you want to capture progress

## Instructions

1. **Gather what happened this session:**
   ```bash
   # Recent commits
   git log --oneline -10 --since="6 hours ago"

   # Or if on a feature branch, commits on this branch
   git log --oneline main..HEAD

   # Files changed
   git diff --stat HEAD~5..HEAD 2>/dev/null || git diff --stat
   ```

2. **Read current worklog:**
   ```bash
   cat docs/worklog/now.md
   ```

3. **Update now.md directly** — don't ask, just do it:
   - Add completed work to "Just Completed" with today's date
   - Move completed items from "Up Next" (mark with [x] or remove)
   - Update "In Progress" if anything is WIP
   - Add new "Up Next" items discovered during the session
   - Keep it concise — bullet points, not paragraphs

4. **Ensure Linear is up to date:**
   - Check for any Linear issues related to work completed this session
   - Move completed issues to "Done" status
   - Update issue descriptions or comments if scope changed during implementation
   - Create new issues for follow-up work identified during the session
   - Use the Linear MCP tools (`linear_update_issue`, `linear_search_issues`, etc.)

5. **Check if recent.md needs updating:**
   - If "Just Completed" section is getting long (>5-6 items)
   - Move older items to recent.md
   - Keep now.md focused on *current* context

6. **Remind about uncommitted changes:**
   ```bash
   git status --short
   ```
   If dirty, ask if they want to commit before wrapping up.

7. **Confirm completion** with a brief summary:
   ```
   Updated now.md and Linear. Working tree is clean.
   ```

## Keep It Light

This should take <30 seconds. Don't over-document:
- now.md = bullet points, not paragraphs
- Save details for commit messages and recent.md
- Goal is quick context recovery, not comprehensive docs

## Example Session

```
User: /wrap-up

Claude: Let me check what we did this session...

        [reads commits, updates now.md, syncs Linear]

        Updated now.md:
        + Just Completed: Gmail OAuth flow and email sync
        + Up Next: added Linear connector

        Linear:
        + PER-42 "Gmail connector" → Done
        + Created PER-45 "Linear connector" (Todo)

        Working tree is clean. You're all set!
```

## Integration with Other Skills

This skill is suggested by:
- `/finish-feature` - After merge completes
- `/switch-branch` - When returning to main
- End of session - Always good to run
