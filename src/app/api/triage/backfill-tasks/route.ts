import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, suggestedTasks, type NewSuggestedTask } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { convertActionItemsToTasks } from "@/lib/triage/extract-tasks";

// POST /api/triage/backfill-tasks - Backfill suggested tasks from existing enrichment data
export async function POST() {
  try {
    let totalCreated = 0;

    // Get all Granola items that have extractedMemory with actionItems
    const items = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.connector, "granola"));

    for (const item of items) {
      const enrichment = item.enrichment as any;
      const actionItems = enrichment?.extractedMemory?.actionItems || enrichment?.actionItems || [];

      if (actionItems.length === 0) continue;

      // Check if tasks already exist for this item
      const existingTasks = await db
        .select()
        .from(suggestedTasks)
        .where(eq(suggestedTasks.sourceItemId, item.id))
        .limit(1);

      if (existingTasks.length > 0) {
        console.log(`[Backfill] Skipping ${item.id} - already has tasks`);
        continue;
      }

      // Convert action items to tasks
      const tasks = convertActionItemsToTasks(actionItems);

      if (tasks.length === 0) continue;

      // Insert tasks
      const tasksToInsert: NewSuggestedTask[] = tasks.map((task) => ({
        sourceItemId: item.id,
        description: task.description,
        assignee: task.assignee,
        assigneeType: task.assigneeType,
        dueDate: task.dueDate,
        confidence: task.confidence,
        status: "suggested" as const,
      }));

      await db.insert(suggestedTasks).values(tasksToInsert);
      totalCreated += tasksToInsert.length;
      console.log(`[Backfill] Created ${tasksToInsert.length} tasks for ${item.subject}`);
    }

    return NextResponse.json({
      success: true,
      tasksCreated: totalCreated,
    });
  } catch (error) {
    console.error("[Backfill] Failed:", error);
    return NextResponse.json(
      { error: "Failed to backfill tasks", details: String(error) },
      { status: 500 }
    );
  }
}
