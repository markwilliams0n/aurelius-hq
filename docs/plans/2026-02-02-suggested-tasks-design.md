# Suggested Tasks Extraction Design

## Overview

Extract potential action items and tasks from all triage items using AI. Display suggested tasks below the triage card for quick accept/dismiss decisions before archiving.

## Requirements

- **All connectors**: Gmail, Slack, Linear, Granola, Manual all get AI task extraction
- **Two categories**: "For You" vs "For Others" based on assignee
- **Quick triage**: Accept all, some, or none with minimal friction
- **Archive behavior**: Remaining suggested tasks auto-dismissed on archive
- **Memory integration**: Accepted tasks create memory facts
- **Future-ready**: Accepted tasks stored for upcoming task/PM system

## Data Model

New `suggested_tasks` table:

```typescript
suggestedTasks = pgTable("suggested_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Link to source triage item
  sourceItemId: uuid("source_item_id").references(() => inboxItems.id),

  // Task content
  description: text("description").notNull(),
  assignee: text("assignee"),           // person name or null
  assigneeType: text("assignee_type"),  // "self" | "other" | "unknown"
  dueDate: text("due_date"),            // extracted due date if mentioned

  // Status
  status: text("status").default("suggested"),  // "suggested" | "accepted" | "dismissed"

  // Metadata
  confidence: text("confidence"),  // "high" | "medium" | "low"
  extractedAt: timestamp("extracted_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),  // when accepted/dismissed
});
```

## AI Extraction

**Identity context from soul.md:**
- Name variants: "Mark", "Mark Williamson"
- Email: "mark@rostr.cc"

**Contextual clues:**
- Sender/recipient fields
- Transcript speaker attribution
- "I will...", "Can you...", "@mentions"

**Output structure:**
```typescript
interface ExtractedTask {
  description: string;
  assignee: string | null;
  assigneeType: "self" | "other" | "unknown";
  dueDate: string | null;
  confidence: "high" | "medium" | "low";
}
```

**assigneeType = "self" when:**
- Task mentions your name or email
- "I will...", "I'll...", "I need to..." in your voice
- Directed at you: "Can you...", "Please send...", "@Mark"

## UI Design

**SuggestedTasksBox** - positioned below triage card:

```
┌─────────────────────────────────────────────────┐
│  📋 Suggested Tasks                 [Accept All]│
├─────────────────────────────────────────────────┤
│  FOR YOU (2)                                    │
│  ┌─────────────────────────────────────────┐   │
│  │ Send proposal to Sarah by Friday    ✓ ✗ │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ Review the Q3 budget numbers        ✓ ✗ │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  FOR OTHERS (1)                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ Sarah: Share design mockups         ✓ ✗ │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

- Same width as triage card (640px)
- Sections hidden if empty
- Box hidden if no suggested tasks
- "Accept All" only affects "For You" tasks

## Interaction Flow

**Task actions:**
- ✓ (Accept): Save to DB + create memory fact, green fade out, toast "Task saved"
- ✗ (Dismiss): Set dismissed, quiet fade out
- Accept All: Accept all "For You" tasks, toast "N tasks saved"

**Keyboard shortcuts:**
- ← Archive: Dismiss remaining suggested tasks, archive item
- ↑ Memory: Push to memory (no effect on tasks)
- Shift+↑ Memory+Archive: Push to memory, dismiss tasks, archive
- → Actions: No change

**Memory integration:**
- Accepted tasks create facts: "Mark committed to send proposal to Sarah by Friday"
- Linked to relevant entity
- Category: "commitment"

## Implementation Files

1. `src/lib/db/schema/tasks.ts` - new suggestedTasks table
2. Run drizzle migration
3. `src/lib/triage/extract-tasks.ts` - AI extraction function
4. Update `enrichTriageItem()` for all connectors
5. Update `src/lib/granola/sync.ts` to use unified extraction
6. `src/app/api/triage/[id]/tasks/route.ts` - accept/dismiss endpoints
7. `src/components/aurelius/suggested-tasks-box.tsx` - UI component
8. Update `triage-client.tsx` - Shift+↑ shortcut, integrate tasks box
9. Update archive handler to dismiss remaining tasks

## Edge Cases

- No tasks extracted: Box doesn't render
- All tasks dismissed before archive: Normal archive flow
- Item has tasks for others only: "For You" section hidden
- Duplicate tasks: AI should deduplicate in extraction
- Vague tasks: Low confidence, still shown but could filter later
