import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, suggestedTasks, type NewSuggestedTask } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { convertActionItemsToTasks } from "@/lib/triage/extract-tasks";
import { addMemory } from "@/lib/memory/supermemory";

/**
 * POST /api/triage/backfill-granola
 *
 * Backfill task extraction + Supermemory save for existing Granola meetings
 * that were synced before the triage redesign. Uses the stored
 * enrichment.extractedMemory data (already AI-extracted during original sync).
 */
export async function POST() {
  // Find Granola items with status "new" that have no suggested_tasks
  const items = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, "granola"),
        eq(inboxItems.status, "new")
      )
    );

  let tasksCreated = 0;
  let memorySaved = 0;
  let skipped = 0;
  const processed: string[] = [];

  for (const item of items) {
    const enrichment = item.enrichment as Record<string, unknown> | null;
    if (!enrichment) {
      skipped++;
      continue;
    }

    // Check if this item already has suggested tasks
    const existingTasks = await db
      .select({ id: suggestedTasks.id })
      .from(suggestedTasks)
      .where(eq(suggestedTasks.sourceItemId, item.id))
      .limit(1);

    const hasExistingTasks = existingTasks.length > 0;

    // Extract action items from stored enrichment
    const actionItems = (enrichment.actionItems as Array<{
      description: string;
      assignee?: string;
      dueDate?: string;
    }>) || [];

    // Create tasks if none exist and we have action items
    if (!hasExistingTasks && actionItems.length > 0) {
      const tasks = convertActionItemsToTasks(actionItems);
      if (tasks.length > 0) {
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
        tasksCreated += tasksToInsert.length;
      }
    }

    // Save to Supermemory using stored extraction data
    const extractedMemory = enrichment.extractedMemory as Record<string, unknown> | undefined;
    const summary = (enrichment.summary as string) || (extractedMemory?.summary as string) || "";
    const topics = (enrichment.topics as string[]) || (extractedMemory?.topics as string[]) || [];
    const facts = (extractedMemory?.facts as Array<{ content: string }>) || [];
    const attendees = (enrichment.attendees as string) || "";

    // Build Supermemory content
    const meetingDate = (enrichment.meetingTime as string) || new Date(item.receivedAt).toLocaleDateString();
    const parts = [
      `Meeting: ${item.subject} (${meetingDate})`,
      attendees ? `Attendees: ${attendees}` : "",
      summary ? `Summary: ${summary}` : "",
    ];

    if (facts.length > 0) {
      parts.push("Key facts:");
      for (const fact of facts.slice(0, 10)) {
        parts.push(`- ${fact.content}`);
      }
    }

    if (actionItems.length > 0) {
      parts.push("Action items:");
      for (const ai of actionItems) {
        const assignee = ai.assignee ? ` [${ai.assignee}]` : "";
        parts.push(`-${assignee} ${ai.description}`);
      }
    }

    if (topics.length > 0) {
      parts.push(`Topics: ${topics.join(", ")}`);
    }

    const content = parts.filter(Boolean).join("\n");

    if (content.length > 50) {
      try {
        await addMemory(content, {
          type: "meeting",
          source: "granola",
          title: item.subject,
          date: meetingDate,
        });
        memorySaved++;
      } catch (err) {
        console.warn(`[Backfill] Supermemory save failed for ${item.subject}:`, err);
      }
    }

    processed.push(item.subject || item.id);
  }

  console.log(
    `[Backfill] Granola backfill complete: ${items.length} items, ${tasksCreated} tasks created, ${memorySaved} saved to Supermemory, ${skipped} skipped`
  );

  return NextResponse.json({
    total: items.length,
    tasksCreated,
    memorySaved,
    skipped,
    processed,
  });
}
