/**
 * Insert a triage item and extract suggested tasks in one operation.
 * This ensures tasks are linked to items via their database ID.
 */

import { db } from "@/lib/db";
import { inboxItems, type NewInboxItem, type InboxItem } from "@/lib/db/schema";
import { extractAndSaveTasks, convertActionItemsToTasks } from "./extract-tasks";
import { suggestedTasks, type NewSuggestedTask } from "@/lib/db/schema";

interface InsertWithTasksOptions {
  /** Skip AI extraction (e.g., if we already have action items from Granola) */
  skipAiExtraction?: boolean;
  /** Pre-extracted action items (from Granola meetings) */
  existingActionItems?: Array<{
    description: string;
    assignee?: string;
    dueDate?: string;
  }>;
  /** Additional context for extraction */
  extractionContext?: {
    attendees?: string;
    transcript?: string;
  };
  /** Default "unknown" assignee types to "self" (for Slack @mentions) */
  defaultToSelf?: boolean;
}

/**
 * Insert a triage inbox item and extract suggested tasks
 * Returns the inserted item with its generated ID
 */
export async function insertInboxItemWithTasks(
  item: NewInboxItem,
  options: InsertWithTasksOptions = {}
): Promise<InboxItem> {
  // Insert the item and get the generated ID
  const [insertedItem] = await db
    .insert(inboxItems)
    .values(item)
    .returning();

  // If we have existing action items (e.g., from Granola extraction), convert and save them
  if (options.existingActionItems && options.existingActionItems.length > 0) {
    const tasks = convertActionItemsToTasks(options.existingActionItems);

    if (tasks.length > 0) {
      const tasksToInsert: NewSuggestedTask[] = tasks.map((task) => ({
        sourceItemId: insertedItem.id,
        description: task.description,
        assignee: task.assignee,
        assigneeType: task.assigneeType,
        dueDate: task.dueDate,
        confidence: task.confidence,
        status: "suggested" as const,
      }));

      await db.insert(suggestedTasks).values(tasksToInsert);
      console.log(
        `[Insert] Saved ${tasksToInsert.length} pre-extracted tasks for item ${insertedItem.id}`
      );
    }
  }
  // Otherwise, run AI extraction for non-Granola items
  else if (!options.skipAiExtraction) {
    try {
      await extractAndSaveTasks(insertedItem.id, item.content, {
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName || undefined,
        subject: item.subject,
        attendees: options.extractionContext?.attendees,
        transcript: options.extractionContext?.transcript,
        defaultToSelf: options.defaultToSelf,
      });
    } catch (error) {
      // Don't fail the insert if task extraction fails
      console.error(
        `[Insert] Task extraction failed for item ${insertedItem.id}:`,
        error
      );
    }
  }

  return insertedItem;
}

/**
 * Batch insert items with task extraction
 * For bulk operations like fake data reset
 */
export async function insertInboxItemsWithTasks(
  items: NewInboxItem[],
  options: { skipAiExtraction?: boolean } = {}
): Promise<InboxItem[]> {
  const insertedItems: InboxItem[] = [];

  for (const item of items) {
    const inserted = await insertInboxItemWithTasks(item, {
      skipAiExtraction: options.skipAiExtraction,
    });
    insertedItems.push(inserted);
  }

  return insertedItems;
}
