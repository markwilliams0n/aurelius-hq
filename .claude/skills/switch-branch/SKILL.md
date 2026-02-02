---
name: switch-branch
description: Smart branch switching - offers to return to main from feature branches, or shows available branches when on main. Use when user says "switch branch", "go to main", "change branch", or "what branches".
---

# Switch Branch

Smart branch switching with context-aware options.

## Instructions

When this skill is invoked:

1. **Check current state:**
   ```bash
   git branch --show-current
   git status --short
   git branch -a --format='%(refname:short)' | grep -v 'origin/' | head -20
   ```

2. **Handle uncommitted changes first** (if any):
   - Show what's uncommitted
   - Offer options:
     1. **Commit first** - Help write a commit message
     2. **Stash** - `git stash push -m "WIP on {branch}: {description}"`
     3. **Bring changes along** - If changes don't conflict, they come with you
     4. **Discard** - `git checkout .` (confirm this is destructive!)

3. **If NOT on main** (on a feature branch):

   Show current branch and offer:
   ```
   You're on: feature/calendar-integration

   Options:
   1. Return to main
   2. Stay here (cancel)

   [If other feature branches exist:]
   3. Switch to feature/notion-connector
   4. Switch to feature/memory-v2
   ```

4. **If ON main**:

   List available feature branches:
   ```
   You're on main.

   Available branches:
   1. feature/calendar-integration (3 commits ahead)
   2. feature/notion-connector (1 commit ahead)
   3. feature/memory-v2 (5 commits ahead)

   Enter number to switch, or 'q' to stay on main:
   ```

   If no other branches:
   ```
   You're on main. No other branches exist.

   Use /new-feature to start a new feature branch.
   ```

5. **Execute the switch:**
   ```bash
   git checkout {branch-name}
   ```

6. **Confirm:**
   ```
   ✓ Switched to: {branch-name}
   ```

## Showing Branch Info

When listing branches, show helpful context:
- How many commits ahead of main
- Last commit date/message (if recent)

```bash
# Commits ahead of main
git rev-list --count main..{branch}

# Last commit info
git log -1 --format='%cr: %s' {branch}
```

## Example Sessions

### From feature branch → main
```
User: /switch-branch

Claude: You're on: feature/calendar-integration
        Status: 2 uncommitted files

        You have uncommitted changes:
          M src/lib/calendar/client.ts
          M src/lib/calendar/sync.ts

        What would you like to do?
        1. Commit these changes first
        2. Stash changes (can restore later)
        3. Discard changes (cannot undo!)

User: 2

Claude: Stashing changes...
        ✓ Stashed: "WIP on feature/calendar-integration"

        Now, where to?
        1. Return to main (Recommended)
        2. Stay on feature/calendar-integration

User: 1

Claude: ✓ Switched to: main

        Tip: Your stashed changes are saved. To restore them later:
        git stash pop
```

### From main → feature branch
```
User: /switch-branch

Claude: You're on main (clean working tree).

        Available branches:
        1. feature/calendar-integration (2 commits ahead, 1 hour ago)
        2. feature/notion-connector (5 commits ahead, 2 days ago)

        Enter number to switch, or 'q' to stay:

User: 1

Claude: ✓ Switched to: feature/calendar-integration

        Recent work on this branch:
        • abc123 - Add calendar sync logic
        • def456 - Create calendar client
```
