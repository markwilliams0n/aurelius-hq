# Changelog

## 2026-02-07 — Triage Enhancements

Triage gets a power-user upgrade: a compact list view for fast scanning, one-key actions for Gmail follow-ups, rich approval cards for creating tasks and drafting emails, and better visibility into who's CC'd on incoming mail.

### Features

- **List view** — Press `V` to toggle between card and list view. Compact table rows with keyboard navigation (arrows, Space to select, Enter to open). Multi-select with bulk archive and undo.

- **Action Needed** — Press `A` on any Gmail item to mark it for follow-up. Applies a Gmail label, snoozes for 3 days, and resurfaces with an amber "Marked for action on [date]" badge. Undo supported.

- **Gmail approval card** — Rich card renderer for email actions (reply, draft). Shows To/CC, subject, body preview with markdown. Inline editing with keyboard shortcuts.

- **Linear approval card** — Rich card for task creation. Auto-focused editable title, collapsible description, priority cycling (`P`), team and assignee badges. `Cmd+Enter` to create.

- **Quick task from triage** — Press `T` on any triage item to create a pre-filled Linear issue. Opens an action card with the triage context in the description, defaulting to PER team and your assignment.

- **CC recipients visible** — Gmail triage cards now show @rostr.cc recipients in the summary view, so you can quickly tell if teammates are already on the thread. Full To/CC details in the expanded view.

- **External links** — All links in chat messages, config cards, and triage detail views now open in a new tab instead of hijacking the current window.

### Try It Out

1. Open Triage and press `V` to switch to list view
2. Use arrow keys to navigate, `Space` to select multiple items, `Backspace` to bulk archive
3. Press `A` on a Gmail item to mark it for action — it'll come back in 3 days
4. Press `T` on any item to create a Linear task from it
5. Check Gmail cards for the new @rostr.cc recipient badges
