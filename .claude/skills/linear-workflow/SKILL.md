---
name: linear-workflow
description: "Project-local override for Linear workflow statuses. This project has no dev environment, so the flow is simplified."
---

# Linear Workflow — Aurelius HQ Override

This overrides the global `linear-workflow` skill's statuses for this project only. All other behavior (issue creation, labels, lifecycle triggers, commit linking, PR descriptions) from the global skill still applies.

## Statuses (Personal Team)

| Status | ID | Type |
|--------|----|------|
| Backlog | `3a3fe30e-d5e0-464c-a656-810798ad8464` | backlog |
| Todo | `8ff14c44-d9b7-4448-819d-7a822065c4b0` | unstarted |
| In Progress | `321ac23c-70c6-4dfa-94c7-87a63e3644ba` | started |
| Done | `1d3fa82d-3108-40e2-a26a-d9addb6bc9e6` | completed |
| Canceled | `4f21dea1-473a-4b1d-a08f-b2bece611d7b` | canceled |
| Duplicate | `22db0a79-92b9-4652-bc72-8463e856acad` | canceled |

## Flow

```
Todo → In Progress → Done
```

There is no "In Review (Dev)", "Needs Changes", or "Ready for Production" in this project.

## Claude Moves

| When | Action |
|------|--------|
| Start working on issue | Move → In Progress |
| Work completed / PR merged | Move → Done |

## Statuses That Do NOT Exist Here

Do not reference or attempt to move issues to:
- ~~In Review (Dev)~~
- ~~Needs Changes~~
- ~~Ready for Production~~

These exist in the global skill but are not applicable to the Personal team's workflow.
