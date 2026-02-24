# Triage UX Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix triage view UX — remove Activity/Triage toggle, add tier filter pills, fix persistent archive items, move activity feed to sidebar.

**Architecture:** Remove the `emailSubView` state and the Activity/Triage tab toggle from the main content area. Replace the vertical tier sections (Archive → Review → Attention) with horizontal filter pills that control which items are shown. Move the activity feed + rule input into the right sidebar as an enhanced Activity tab. Fix archive tier so unchecked items get reclassified to "review" instead of haunting the archive box.

**Tech Stack:** React, TypeScript, Tailwind CSS v4, SWR, Next.js 15

---

### Task 1: Remove Activity/Triage toggle, default to triage

Remove the `emailSubView` state and the Activity/Triage tab toggle from `triage-client.tsx`. The main content area should always show the triage workflow when on the Gmail connector filter.

**Files:**
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Remove emailSubView state and toggle UI**

In `triage-client.tsx`:
- Remove the `emailSubView` state: `const [emailSubView, setEmailSubView] = useState<"activity" | "triage">("activity");`
- Remove the entire `{connectorFilter === "gmail" && (` toggle block inside the header (the Activity/Triage pill switcher, approx lines 335-360)
- Remove the `TriageActivityFeed` import
- Remove the conditional rendering block for `TriageActivityFeed` (approx lines 397-402): `{!isLoading && connectorFilter === "gmail" && triageView === "card" && emailSubView === "activity" && (`
- Update the `TriageEmailTiers` condition to remove `emailSubView === "triage"` — it should just be: `{!isLoading && hasItems && connectorFilter === "gmail" && triageView === "card" && (`

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/triage/triage-client.tsx
git commit -m "refactor: remove Activity/Triage toggle, always show triage view"
```

---

### Task 2: Add tier filter pills to replace vertical sections

Replace the stacked Archive/Review/Attention sections with horizontal filter pills at the top. Clicking a pill filters which items are shown. The default selected pill should be based on what has items (prefer "Attention" if it has items, then "Review", then "Archive").

**Files:**
- Modify: `src/components/aurelius/triage-email-tiers.tsx`

**Step 1: Rewrite TriageEmailTiers with filter pills**

Replace the entire component with a new layout:

```tsx
type TierFilter = "all" | "archive" | "review" | "attention";

export function TriageEmailTiers({
  items,
  tasksByItemId,
  onBulkArchive,
  onSelectItem,
  onSkipFromArchive,
  activeItemId,
}: EmailTiersProps) {
  // Compute tier counts
  const { archiveItems, reviewItems, attentionItems } = useMemo(() => { ... }, [items]);

  // Default to first non-empty tier (prefer attention > review > archive)
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");

  // Get displayed items based on filter
  const displayedItems = useMemo(() => {
    switch (tierFilter) {
      case "archive": return archiveItems;
      case "review": return reviewItems;
      case "attention": return attentionItems;
      default: return items;
    }
  }, [tierFilter, archiveItems, reviewItems, attentionItems, items]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter pills */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
        <FilterPill label="All" count={items.length} active={tierFilter === "all"} onClick={() => setTierFilter("all")} />
        <FilterPill label="Archive" count={archiveItems.length} active={tierFilter === "archive"} onClick={() => setTierFilter("archive")} color="green" icon={<Archive />} />
        <FilterPill label="Review" count={reviewItems.length} active={tierFilter === "review"} onClick={() => setTierFilter("review")} color="gold" icon={<Eye />} />
        <FilterPill label="Attention" count={attentionItems.length} active={tierFilter === "attention"} onClick={() => setTierFilter("attention")} color="orange" icon={<AlertCircle />} />
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Archive batch box (only when Archive filter is active) */}
        {tierFilter === "archive" && archiveItems.length > 0 && (
          <ArchiveBatchBox items={archiveItems} onBulkArchive={onBulkArchive} onSkip={onSkipFromArchive} />
        )}

        {/* Individual cards (for review, attention, or all) */}
        {tierFilter !== "archive" && (
          <div className="space-y-4">
            {displayedItems.map((item) => (
              <div key={item.id} className="flex flex-col items-center gap-2">
                <div className="cursor-pointer" onClick={() => onSelectItem(item)}>
                  <TriageCard item={item} isActive={activeItemId === item.id} />
                </div>
                {/* AI reasoning */}
                {getReasoning(item) && (
                  <div className="w-[640px] max-w-2xl px-4 py-2 rounded-lg bg-secondary/30 border border-border/50">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">AI:</span> {getReasoning(item)}
                      <span className="ml-2 text-[10px] opacity-60">({Math.round(getConfidence(item) * 100)}%)</span>
                    </p>
                  </div>
                )}
                {/* Suggested tasks for attention items */}
                {getTier(item) === "attention" && activeItemId === item.id && (
                  <SuggestedTasksBox itemId={item.dbId || item.id} initialTasks={tasksByItemId[item.dbId || item.id] as any} />
                )}
              </div>
            ))}
          </div>
        )}

        {displayedItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p>No emails in this category.</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

The `FilterPill` is a small local component:

```tsx
function FilterPill({ label, count, active, onClick, color, icon }: {
  label: string; count: number; active: boolean; onClick: () => void;
  color?: string; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
        active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
    >
      {icon && <span className="w-3.5 h-3.5">{icon}</span>}
      {label}
      <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]", active ? "bg-foreground/15" : "bg-secondary")}>
        {count}
      </span>
    </button>
  );
}
```

The `ArchiveBatchBox` replaces the old `ArchiveTier` — same checklist/Archive All UI but with a "Skip" button per item that calls `onSkipFromArchive(item)`.

**Step 2: Add onSkipFromArchive prop**

Add to `EmailTiersProps`:
```tsx
onSkipFromArchive?: (item: TriageItem) => void;
```

The Archive batch box should have a small "Skip" button next to the checkbox for each item. When clicked, it calls `onSkipFromArchive(item)` which will reclassify the item to "review" tier.

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/components/aurelius/triage-email-tiers.tsx
git commit -m "feat: replace tier sections with filter pills"
```

---

### Task 3: Wire skip-from-archive action

When a user skips an item from the archive tier, update its classification to `review` so it moves to the Review pill instead of haunting the archive box.

**Files:**
- Modify: `src/hooks/use-triage-actions.ts`
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Add handleSkipFromArchive action**

In `use-triage-actions.ts`, add a new handler:

```tsx
const handleSkipFromArchive = useCallback(async (item: TriageItem) => {
  const apiId = item.dbId || item.id;
  try {
    const res = await fetch(`/api/triage/${apiId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classification: {
          ...((item as any).classification || {}),
          recommendation: "review",
          // Keep existing confidence but cap at 0.85 so it doesn't re-enter archive tier
        },
      }),
    });
    if (!res.ok) throw new Error();
    // Optimistically update local items
    setLocalItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, classification: { ...((i as any).classification || {}), recommendation: "review" } } as any
          : i
      )
    );
    toast.success("Moved to review");
  } catch {
    toast.error("Failed to move item");
  }
}, [setLocalItems]);
```

Export it from the return object.

**Step 2: Check if PUT /api/triage/[id] supports classification update**

Read `src/app/api/triage/[id]/route.ts` PUT handler. If it doesn't support updating `classification`, add support:

```tsx
if (body.classification) {
  updateData.classification = body.classification;
}
```

**Step 3: Wire into triage-client**

In `triage-client.tsx`, pass `onSkipFromArchive={actions.handleSkipFromArchive}` to `<TriageEmailTiers>`.

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/hooks/use-triage-actions.ts src/app/triage/triage-client.tsx src/app/api/triage/\[id\]/route.ts
git commit -m "feat: add skip-from-archive action to move items to review"
```

---

### Task 4: Move activity feed + rule input into the sidebar

Move the classification activity feed into the right sidebar as an enhanced "Activity" tab. The existing sidebar Activity tab shows triage actions (archived, snoozed, etc.) — merge the classification feed (with override highlighting and rule input) into it.

**Files:**
- Modify: `src/components/aurelius/triage-sidebar.tsx`
- Modify: `src/app/triage/triage-client.tsx`

**Step 1: Add classification feed to sidebar Activity tab**

In `triage-sidebar.tsx`, add a third sub-section below the existing activity list. This doesn't replace the existing undo-capable activity list — it adds the classification feed below it, behind a "Classifications" collapsible header.

Add SWR fetch for `/api/triage/activity?limit=50` inside the sidebar. Render a condensed version of the activity feed entries (sender, recommendation icon, confidence, override flag). Include the "Manage Rules" button and the rule input box at the bottom.

The classification entries should be compact — one line per entry:
```
[icon] Sender Name — Subject (95%)
       ⚠ Override — suggested archive, you reviewed
```

Add props to `TriageSidebarProps`:
```tsx
onOpenRulesPanel: () => void;
onCreateRule: (input: string) => void;
```

**Step 2: Pass new props from triage-client**

In `triage-client.tsx`, pass `onOpenRulesPanel` and `onCreateRule` to `<TriageSidebar>`:

```tsx
<TriageSidebar
  stats={stats}
  // ...existing props...
  onOpenRulesPanel={() => setIsRulesPanelOpen(true)}
  onCreateRule={actions.handleRuleInput}
/>
```

**Step 3: Remove TriageActivityFeed import from triage-client**

If not already removed in Task 1, clean up any remaining activity feed references.

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/components/aurelius/triage-sidebar.tsx src/app/triage/triage-client.tsx
git commit -m "feat: move classification feed and rule input to sidebar"
```

---

### Task 5: Final cleanup and verification

**Files:**
- Possibly modify: `src/components/aurelius/triage-activity-feed.tsx` (delete or keep for reference)
- Review: all modified files

**Step 1: Check for dead imports**

Look for any remaining imports of `TriageActivityFeed` or `emailSubView` references across the codebase.

**Step 2: Run full verification**

```bash
npx tsc --noEmit
npx vitest run
```

**Step 3: Manual QA checklist**

- [ ] Gmail tab defaults to showing triage tier view (no Activity/Triage toggle)
- [ ] Filter pills show at top: All | Archive | Review | Attention with counts
- [ ] Clicking Archive pill shows batch box with Archive All button
- [ ] Unchecking items and archiving the rest → unchecked items move to Review
- [ ] Skip button in archive tier moves item to Review pill
- [ ] Review and Attention pills show individual cards with AI reasoning
- [ ] Right sidebar Activity tab shows classification feed with overrides
- [ ] Rule input box is in sidebar (not main content area)
- [ ] Manage Rules button in sidebar opens rules panel slide-out
- [ ] Keyboard shortcuts still work (ArrowLeft, Shift+ArrowLeft, etc.)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: cleanup dead code from triage UX refactor"
```
