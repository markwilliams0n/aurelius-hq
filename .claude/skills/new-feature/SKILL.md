---
name: new-feature
description: Start a new feature branch for development. Use when the user says "new feature", "start feature", "create branch", or wants to begin work on something new.
---

# New Feature Branch

Creates a feature branch for new development work.

## Instructions

When this skill is invoked:

1. **Check current state:**
   ```bash
   git status --short
   git branch --show-current
   ```

2. **If not on main**, warn the user:
   - Show current branch name
   - Ask if they want to finish current work first or switch to main
   - Suggest using `/switch-branch` to get back to main

3. **If there are uncommitted changes**, handle them:
   - Show what's uncommitted
   - Offer options:
     1. Commit changes first (help write commit message)
     2. Stash changes (`git stash push -m "WIP: description"`)
     3. Discard changes (confirm this is destructive)

4. **Get feature name** from user if not provided:
   - Ask: "What are you building? (brief name, e.g., 'notion-connector', 'snooze-feature')"
   - Convert to branch-friendly format (lowercase, hyphens)

5. **Create the branch:**
   ```bash
   git checkout -b feature/{name}
   ```

6. **Confirm and remind of workflow:**
   ```
   ✓ Created branch: feature/{name}

   Workflow reminder:
   • Work and commit freely on this branch
   • Run `/switch-branch` to get back to main if needed
   • Run `/finish-feature` when done to merge back
   ```

## Branch Naming

Format: `feature/{short-description}`

Examples:
- `feature/notion-connector`
- `feature/snooze-improvements`
- `feature/memory-v2`

## Example Session

```
User: /new-feature

Claude: You're currently on main with a clean working tree.
        What feature are you starting? (brief name)

User: calendar integration

Claude: Creating feature branch...

        ✓ Created branch: feature/calendar-integration

        You're ready to start! Remember:
        • Commit early and often
        • /switch-branch to hop back to main
        • /finish-feature when ready to merge
```
