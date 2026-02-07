# Triage Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve triage workflow with list view, action-needed labeling, rich approval cards, quick task creation, CC visibility, and external link behavior.

**Architecture:** Extends existing triage-client with a list/card view toggle, new keyboard shortcuts (`A` for action-needed, `T` now creates action card), Gmail client label management, and handler-specific card renderers for Gmail and Linear following the Slack card pattern.

**Tech Stack:** Next.js 15, React, Tailwind CSS v4, Drizzle ORM, Gmail API, Linear GraphQL API, action card system.

---

## Task 1: External links open in new tab (PER-138)

Quick win — sweep all link rendering to use `target="_blank"`.

**Files:**
- Modify: `src/components/aurelius/triage-card.tsx` (any `<a>` tags)
- Modify: `src/components/aurelius/triage-detail-modal.tsx` (any `<a>` tags)
- Modify: `src/components/aurelius/chat-message.tsx` (ReactMarkdown link component override)
- Modify: `src/components/aurelius/cards/config-card.tsx` (ReactMarkdown link component override)

**Step 1: Add link component override to ReactMarkdown usages**

In each file using `<ReactMarkdown>`, add a `components` prop that renders links with `target="_blank"` and `rel="noopener noreferrer"`:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
  }}
>
```

**Step 2: Find all `<a>` tags in triage components**

Search for `<a ` in triage-card.tsx and triage-detail-modal.tsx. Add `target="_blank" rel="noopener noreferrer"` to any external links (skip internal Next.js links).

**Step 3: Verify**

Run `tsc --noEmit` and visually check in browser.

**Step 4: Commit**

```
feat: external links open in new tab (PER-138)
```

---

## Task 2: Gmail CC recipients on triage card (PER-140)

Show @rostr.cc recipients in the triage card summary line. Full CC list shown in detail modal.

**Files:**
- Modify: `src/lib/gmail/sync.ts` — Extract CC/To recipients into enrichment
- Modify: `src/lib/db/schema/triage.ts` — Add `recipients` to TriageItem enrichment type (type-only, no migration needed since enrichment is jsonb)
- Modify: `src/components/aurelius/triage-card.tsx` — Show internal recipients badge
- Modify: `src/components/aurelius/triage-detail-modal.tsx` — Show full To/CC in expanded view

**Step 1: Extract recipients during Gmail sync**

In `src/lib/gmail/sync.ts`, inside `transformToInboxItem()`, extract To/CC headers from the email and store in enrichment:

```typescript
// In enrichment object:
recipients: {
  to: parseRecipients(email.to),      // [{email, name}]
  cc: parseRecipients(email.cc),      // [{email, name}]
  internal: [...to, ...cc].filter(r => r.email.endsWith('@rostr.cc')),
}
```

Add a `parseRecipients(header: string)` helper that parses "Name <email>" format.

**Step 2: Show internal recipients on triage card**

In `triage-card.tsx`, after the sender tags section, if `enrichment.recipients?.internal` has entries, show:

```tsx
{internalRecipients.length > 0 && (
  <div className="flex items-center gap-1 text-xs text-green-400">
    <Users className="w-3 h-3" />
    {internalRecipients.map(r => r.email.replace('@rostr.cc', '')).join(', ')}
  </div>
)}
```

**Step 3: Show full recipients in detail modal**

In `triage-detail-modal.tsx`, add a To/CC section showing all recipients (not just internal).

**Step 4: Verify and commit**

```
feat: show @rostr.cc recipients on Gmail triage cards (PER-140)
```

**Note:** Existing items won't have recipient data until next sync. New items will.

---

## Task 3: Triage list view (PER-170)

Add a list/card toggle to the triage page. List supports multi-select for bulk archive, click to open triage card, Escape returns to list.

**Files:**
- Create: `src/components/aurelius/triage-list-view.tsx` — New list view component
- Modify: `src/app/triage/triage-client.tsx` — Add view toggle state, render list or card view, keyboard shortcuts for list mode

**Step 1: Add view toggle state to triage-client**

Add `triageView` state: `"card" | "list"`, default `"card"`. Add a toggle button in the header next to the sync button. Add keyboard shortcut `v` to toggle views.

```typescript
type TriageView = "card" | "list";
const [triageView, setTriageView] = useState<TriageView>("card");
```

**Step 2: Create TriageListView component**

`src/components/aurelius/triage-list-view.tsx`:

Props:
```typescript
interface TriageListViewProps {
  items: TriageItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkArchive: () => void;
  onOpenItem: (id: string) => void;
}
```

Renders a table/list with columns:
- Checkbox (multi-select)
- Connector icon
- Sender (name or email)
- Subject (truncated)
- Internal recipients (if Gmail, @rostr.cc badge)
- Priority badge
- Time ago
- Click row → `onOpenItem`

Keyboard shortcuts (when list is focused):
- `Space` — toggle select on focused row
- `Enter` — open focused row (triggers card view for that item)
- `Shift+A` — select all
- `Backspace` or `Delete` — bulk archive selected

Style: Compact rows, subtle hover, selected rows highlighted.

**Step 3: Wire list view into triage-client**

Add selection state:
```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

When `triageView === "list"`, render `<TriageListView>` instead of the card stack. When an item is opened from the list, show the existing triage card overlay (reuse `viewMode === "detail"`), and on Escape, return to list view.

Bulk archive: iterate selected IDs, fire archive API for each (parallel), remove from list, clear selection.

**Step 4: Handle list→card→list navigation**

When opening an item from list view:
- Set `currentIndex` to the item's index in filteredItems
- Set a flag like `returnToList: true`
- Show the card view centered (same as current triage view but for that specific item)
- On Escape: if `returnToList`, go back to list view instead of closing

**Step 5: Verify and commit**

```
feat: triage list view with multi-select bulk archive (PER-170)
```

---

## Task 4: "Action Needed" Gmail label (PER-171)

`A` shortcut applies Gmail "Action Needed" label, hides item for 3 days, resurfaces with context.

**Files:**
- Modify: `src/lib/gmail/client.ts` — Add `addLabel(messageId, labelName)` function
- Modify: `src/lib/gmail/actions.ts` — Add `markActionNeeded(itemId)` function
- Modify: `src/app/api/triage/[id]/route.ts` — Add `action-needed` action type
- Modify: `src/app/triage/triage-client.tsx` — Add `A` keyboard shortcut
- Modify: `src/app/api/triage/route.ts` — When waking snoozed items, add "Marked for action on X" context
- Modify: `src/components/aurelius/triage-card.tsx` — Show "Marked for action on X" label if present

**Step 1: Add Gmail label management to client**

In `src/lib/gmail/client.ts`, add:

```typescript
export async function addLabel(messageId: string, labelName: string): Promise<void> {
  const gmail = await getGmailClient();

  // Find label ID by name
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const label = labels.data.labels?.find(l => l.name === labelName);
  if (!label?.id) throw new Error(`Label "${labelName}" not found`);

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [label.id] },
  });
}
```

**Step 2: Add markActionNeeded action**

In `src/lib/gmail/actions.ts`:

```typescript
export async function markActionNeeded(itemId: string): Promise<void> {
  const item = await findInboxItem(itemId);
  if (!item) throw new Error('Item not found');

  const messageId = (item.rawPayload as any)?.messageId;
  if (messageId) {
    await addLabel(messageId, 'Action Needed');
  }
}
```

**Step 3: Add action-needed API action**

In the POST handler of `src/app/api/triage/[id]/route.ts`, add an `action-needed` case:

```typescript
case "action-needed": {
  // Snooze for 3 days
  const snoozeUntil = new Date();
  snoozeUntil.setDate(snoozeUntil.getDate() + 3);

  await db.update(inboxItems)
    .set({
      status: "snoozed",
      snoozedUntil: snoozeUntil,
      enrichment: {
        ...currentEnrichment,
        actionNeededDate: new Date().toISOString(),
      },
    })
    .where(eq(inboxItems.id, item.id));

  // Apply Gmail label in background
  markActionNeeded(item.id).catch(console.error);
  break;
}
```

**Step 4: Add `A` shortcut to triage-client**

In the keyboard handler, add `case "a"` that fires the action-needed API, animates out, and shows toast "Marked for action".

**Step 5: Show context when item resurfaces**

In `triage-card.tsx`, check for `enrichment.actionNeededDate` and render:

```tsx
{enrichment.actionNeededDate && (
  <div className="text-xs text-amber-400 flex items-center gap-1">
    <Clock className="w-3 h-3" />
    Marked for action on {new Date(enrichment.actionNeededDate).toLocaleDateString()}
  </div>
)}
```

**Step 6: Verify and commit**

```
feat: "Action Needed" Gmail label with 3-day snooze (PER-171)
```

---

## Task 5: Gmail approval card rich rendering (PER-172)

Build a `GmailCardContent` component following the Slack message card pattern.

**Files:**
- Create: `src/components/aurelius/cards/gmail-card.tsx` — Rich Gmail card renderer
- Modify: `src/components/aurelius/cards/approval-card.tsx` — Route `gmail:` handlers to new component

**Step 1: Create GmailCardContent component**

`src/components/aurelius/cards/gmail-card.tsx`:

Props: same as `SlackMessageCardContent` — `{ card, onDataChange, onAction }`.

Renders:
- **To** line with recipient emails
- **CC** line (if present)
- **Subject** line (bold)
- **Body** with markdown rendering (ReactMarkdown)
- **Draft vs Send** indicator based on `GMAIL_ENABLE_SEND` or `data.forceDraft`
- Editable body (click to edit, textarea, Cmd+Enter to confirm)
- Keyboard shortcuts: `E` to edit, `Esc` to cancel edit

Data shape from handler:
```typescript
{
  itemId: string;
  to: string;
  cc?: string;
  subject?: string;
  body: string;
  forceDraft?: boolean;
}
```

**Step 2: Route Gmail handlers in approval-card.tsx**

```tsx
if (card.handler?.startsWith("gmail:")) {
  return <GmailCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
}
```

**Step 3: Verify and commit**

```
feat: Gmail approval card rich renderer (PER-172)
```

---

## Task 6: Linear approval card rich rendering with editable fields (PER-173)

Build a `LinearCardContent` component with editable title, description, priority, assignee.

**Files:**
- Create: `src/components/aurelius/cards/linear-card.tsx` — Rich Linear card renderer
- Modify: `src/components/aurelius/cards/approval-card.tsx` — Route `linear:` handlers to new component
- Modify: `src/lib/action-cards/handlers/linear.ts` — Ensure handler reads updated card.data fields

**Step 1: Create LinearCardContent component**

`src/components/aurelius/cards/linear-card.tsx`:

Props: same pattern — `{ card, onDataChange, onAction }`.

Renders:
- **Title** — editable inline text input
- **Description** — collapsible, markdown-rendered, click to edit with textarea
- **Team** — display badge (from data.teamName)
- **Priority** — dropdown/cycle: None(0), Urgent(1), High(2), Medium(3), Low(4)
- **Assignee** — display name (from data.assigneeName), not editable for now

On field edit, call `onDataChange` with updated data so the handler receives the latest values.

Data shape:
```typescript
{
  title: string;
  description?: string;
  teamId: string;
  teamName?: string;
  assigneeId?: string;
  assigneeName?: string;
  projectId?: string;
  priority?: number;
}
```

Keyboard shortcuts: `E` to edit title, `P` to cycle priority.

**Step 2: Route Linear handlers in approval-card.tsx**

```tsx
if (card.handler?.startsWith("linear:")) {
  return <LinearCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
}
```

**Step 3: Verify and commit**

```
feat: Linear approval card rich renderer with editable fields (PER-173)
```

---

## Task 7: Quick task creation via action card (PER-176)

`T` shortcut creates a Linear issue action card pre-filled from the triage item.

**Files:**
- Modify: `src/app/triage/triage-client.tsx` — Change `T` handler to create action card instead of opening TaskCreatorPanel
- Modify: `src/app/api/triage/chat/route.ts` or create new API route — Build and persist Linear action card from triage item
- Create: `src/app/api/triage/[id]/quick-task/route.ts` — API to create a pre-filled Linear action card

**Step 1: Create quick-task API endpoint**

`src/app/api/triage/[id]/quick-task/route.ts`:

POST handler that:
1. Fetches the triage item
2. Fetches Linear viewer context (default team, assignee)
3. Creates an action card with:
   - `pattern: "approval"`
   - `handler: "linear:create-issue"`
   - `title: "Create task"`
   - `data`: `{ title: "", description: itemSummary, teamId: defaultTeamId, teamName, assigneeId: ownerId, assigneeName, priority: 0 }`
4. Returns the card data

The description pre-fills with triage item context:
```
Source: [connector] from [sender]
Subject: [subject]

[summary or content preview]
```

Title is left blank for the user to fill in.

**Step 2: Update T shortcut in triage-client**

Change the `t` case to:
1. Call `POST /api/triage/{id}/quick-task`
2. Receive the action card
3. Show it inline (set a new viewMode like `"quick-task"` that renders the action card component)
4. On confirm → card handler creates the Linear issue
5. On cancel → dismiss card, return to triage

**Step 3: Wire action card rendering for quick-task mode**

In triage-client, when `viewMode === "quick-task"`, render the `ActionCard` component with the card data. This reuses the existing action card infrastructure + the new LinearCardContent from Task 6.

**Step 4: Verify and commit**

```
feat: T shortcut creates Linear issue via action card (PER-176)
```

---

## Execution Order

The tasks are ordered by dependency:

1. **Task 1** (PER-138) — Quick win, no deps
2. **Task 2** (PER-140) — Gmail enrichment, no deps
3. **Task 3** (PER-170) — List view, no deps on other tasks
4. **Task 4** (PER-171) — Action needed, needs Gmail client changes
5. **Task 5** (PER-172) — Gmail card renderer, no deps
6. **Task 6** (PER-173) — Linear card renderer, no deps
7. **Task 7** (PER-176) — Quick task, depends on Task 6 (Linear card renderer)

Tasks 1-2 are small and can be done quickly. Task 3 is the largest. Tasks 5-6 are medium. Task 7 ties together Task 6 with triage.
