---
name: wrap-up
description: Update worklog with current session progress. Use after completing features, significant commits, switching branches, or ending a session. Triggers on "wrap up", "update worklog", "session end", "what did we do".
---

# Wrap Up

Quick worklog update to maintain session context.

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

3. **Propose updates** to the user:
   ```
   Based on this session, here's what I'd update in now.md:

   ## Just Completed
   + Added Gmail OAuth flow
   + Created email sync logic

   ## In Progress
   (unchanged / or note what's WIP)

   ## Up Next
   - [x] Gmail connector ← DONE, remove
   - [ ] Linear connector ← still todo

   Want me to update now.md with these changes?
   ```

4. **If user approves**, update the file:
   - Move completed items from "Up Next" to "Just Completed"
   - Update date header if it's a new day
   - Keep it concise - details go in recent.md/changelog.md

5. **Check if recent.md needs updating:**
   - If "Just Completed" section is getting long (>5-6 items)
   - Suggest moving older items to recent.md
   - Keep now.md focused on *current* context

6. **Remind about uncommitted changes:**
   ```bash
   git status --short
   ```
   If dirty, ask if they want to commit before wrapping up.

## Keep It Light

This should take <30 seconds. Don't over-document:
- now.md = bullet points, not paragraphs
- Save details for commit messages and recent.md
- Goal is quick context recovery, not comprehensive docs

## Example Session

```
User: /wrap-up

Claude: Let me check what we did this session...

        Commits (last 3 hours):
        • abc123 - feat: add Gmail OAuth flow
        • def456 - feat: create email sync
        • ghi789 - fix: handle token refresh

        Current now.md shows "Gmail connector" in Up Next.

        Proposed update:

        ## Just Completed (2026-02-02 Evening)
        - Added Gmail OAuth flow and email sync
        - (previously: branching workflow skills)

        ## Up Next
        - [ ] Linear connector
        - [ ] Task/PM system

        Update now.md? (y/n)

User: y

Claude: ✓ Updated docs/worklog/now.md

        Working tree is clean. You're all set!
```

## Integration with Other Skills

This skill is suggested by:
- `/finish-feature` - After merge completes
- `/switch-branch` - When returning to main
- End of session - Always good to run
