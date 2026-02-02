---
name: finish-feature
description: Merge a feature branch back to main. Use when user says "finish feature", "merge to main", "done with feature", "complete branch", or is ready to merge their work.
---

# Finish Feature

Merges the current feature branch back to main with a clean squash merge.

## Instructions

When this skill is invoked:

1. **Check current state:**
   ```bash
   git branch --show-current
   git status --short
   ```

2. **Validate we're on a feature branch:**
   - If on `main`: "You're already on main. Nothing to merge."
   - If on a feature branch: Continue

3. **Check for uncommitted changes:**
   - If dirty, prompt to commit first
   - Help write a commit message if needed

4. **Show what will be merged:**
   ```bash
   # Commits that will be merged
   git log main..HEAD --oneline

   # Files changed
   git diff main --stat
   ```

5. **Confirm the merge:**
   ```
   Ready to merge feature/calendar-integration → main

   This will:
   • Squash 5 commits into 1 clean commit
   • Switch to main
   • Delete the feature branch

   Proceed? (y/n)
   ```

6. **Execute the merge:**
   ```bash
   # Get the branch name
   BRANCH=$(git branch --show-current)

   # Switch to main
   git checkout main

   # Squash merge
   git merge --squash $BRANCH

   # Commit with descriptive message
   git commit -m "feat: {description of feature}"

   # Delete the feature branch
   git branch -d $BRANCH
   ```

7. **Write a good commit message:**
   - Summarize the feature based on the commits
   - Use conventional commit format: `feat:`, `fix:`, `docs:`, etc.
   - Include key changes in the body if substantial

8. **Confirm completion:**
   ```
   ✓ Merged feature/calendar-integration → main
   ✓ Deleted branch feature/calendar-integration

   main is now at: abc1234 feat: add calendar integration

   Summary of changes:
   • 5 files changed, 234 insertions, 12 deletions
   ```

## Merge Strategy

We use **squash merge** to keep main's history clean:
- All feature commits become one clean commit on main
- Easier to understand history
- Easier to revert if needed

## Handling Conflicts

If there are merge conflicts:

1. Show the conflicting files
2. Help resolve each conflict
3. Stage resolved files
4. Complete the merge

```bash
# After resolving conflicts
git add .
git commit -m "feat: {description}"
```

## Abort Option

At any point, offer to abort:
```bash
git merge --abort
git checkout {original-branch}
```

## Example Session

```
User: /finish-feature

Claude: You're on: feature/calendar-integration

        Commits to merge (5):
        • abc123 - Add calendar sync endpoint
        • def456 - Create calendar client
        • ghi789 - Add calendar types
        • jkl012 - Fix timezone handling
        • mno345 - Add tests

        Files changed: 8 files (+342, -15)

        Ready to squash merge to main?
        1. Yes, merge now
        2. Let me review first (show diff)
        3. Cancel

User: 1

Claude: Merging...

        ✓ Switched to main
        ✓ Squash merged feature/calendar-integration

        Commit message:
        feat: add calendar integration

        - Calendar sync with Google Calendar API
        - Timezone-aware event handling
        - Full test coverage

        ✓ Deleted branch feature/calendar-integration

        Done! main now includes your calendar integration.
```

## Edge Cases

**Nothing to merge:**
```
feature/xyz is up to date with main. Nothing to merge.
```

**Branch has conflicts with main:**
```
Conflicts detected with main. Would you like to:
1. Resolve conflicts now
2. Rebase on main first (recommended)
3. Cancel and handle manually
```

## After Merge

Always suggest updating the worklog:
```
✓ Merged feature/calendar-integration → main

Run /wrap-up to update the worklog? This keeps now.md current
for the next session.
```
