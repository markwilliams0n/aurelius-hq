import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestedTasks, inboxItems } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";

// GET /api/triage/[id]/tasks - List suggested tasks for an item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // First find the inbox item by externalId or id
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);

    if (!item) {
      // Try by direct ID
      const [itemById] = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .limit(1);

      if (!itemById) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }

      const tasks = await db
        .select()
        .from(suggestedTasks)
        .where(
          and(
            eq(suggestedTasks.sourceItemId, itemById.id),
            eq(suggestedTasks.status, "suggested")
          )
        );

      return NextResponse.json({
        tasks,
        forYou: tasks.filter((t) => t.assigneeType === "self"),
        forOthers: tasks.filter((t) => t.assigneeType === "other"),
      });
    }

    const tasks = await db
      .select()
      .from(suggestedTasks)
      .where(
        and(
          eq(suggestedTasks.sourceItemId, item.id),
          eq(suggestedTasks.status, "suggested")
        )
      );

    return NextResponse.json({
      tasks,
      forYou: tasks.filter((t) => t.assigneeType === "self"),
      forOthers: tasks.filter((t) => t.assigneeType === "other"),
    });
  } catch (error) {
    console.error("[Tasks API] Failed to fetch tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

// POST /api/triage/[id]/tasks - Accept or dismiss tasks
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { action, taskIds, all, assigneeType } = body as {
      action: "accept" | "dismiss";
      taskIds?: string[];
      all?: boolean;
      assigneeType?: "self" | "other"; // For "Accept All" which only affects "self"
    };

    if (!action || !["accept", "dismiss"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'accept' or 'dismiss'" },
        { status: 400 }
      );
    }

    // Find the inbox item
    let itemId: string;
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);

    if (item) {
      itemId = item.id;
    } else {
      const [itemById] = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .limit(1);

      if (!itemById) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      itemId = itemById.id;
    }

    // Build query conditions
    const conditions = [
      eq(suggestedTasks.sourceItemId, itemId),
      eq(suggestedTasks.status, "suggested"),
    ];

    // Filter by specific task IDs
    if (taskIds && taskIds.length > 0) {
      conditions.push(inArray(suggestedTasks.id, taskIds));
    }

    // Filter by assignee type (for "Accept All" which only affects "self")
    if (assigneeType) {
      conditions.push(eq(suggestedTasks.assigneeType, assigneeType));
    }

    // Get tasks to update
    const tasksToUpdate = await db
      .select()
      .from(suggestedTasks)
      .where(and(...conditions));

    if (tasksToUpdate.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    // Update task status
    const newStatus = action === "accept" ? "accepted" : "dismissed";
    await db
      .update(suggestedTasks)
      .set({
        status: newStatus,
        resolvedAt: new Date(),
      })
      .where(inArray(suggestedTasks.id, tasksToUpdate.map((t) => t.id)));

    // If accepting tasks, create memory facts
    if (action === "accept") {
      for (const task of tasksToUpdate) {
        try {
          // Create or find an entity for the task
          // If it's a self task, link to a "Commitments" or user entity
          // If it's for someone else, link to that person
          const entityName = task.assignee || "Commitments";
          const entityType = task.assigneeType === "self" ? "topic" : "person";

          const entity = await upsertEntity(entityName, entityType as any, {
            sourceTask: task.id,
          });

          // Create a memory fact for the commitment
          const factContent =
            task.assigneeType === "self"
              ? `Committed to: ${task.description}${task.dueDate ? ` (due: ${task.dueDate})` : ""}`
              : `${task.assignee} will: ${task.description}${task.dueDate ? ` (due: ${task.dueDate})` : ""}`;

          await createFact(
            entity.id,
            factContent,
            "context", // Using "context" for task commitments
            "document",
            itemId
          );
        } catch (memoryError) {
          console.error(
            `[Tasks API] Failed to create memory for task ${task.id}:`,
            memoryError
          );
        }
      }
    }

    return NextResponse.json({
      updated: tasksToUpdate.length,
      action,
      taskIds: tasksToUpdate.map((t) => t.id),
    });
  } catch (error) {
    console.error("[Tasks API] Failed to update tasks:", error);
    return NextResponse.json(
      { error: "Failed to update tasks" },
      { status: 500 }
    );
  }
}

// DELETE /api/triage/[id]/tasks - Dismiss all remaining tasks (called on archive)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Find the inbox item
    let itemId: string;
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);

    if (item) {
      itemId = item.id;
    } else {
      const [itemById] = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .limit(1);

      if (!itemById) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      itemId = itemById.id;
    }

    // Dismiss all remaining suggested tasks
    const result = await db
      .update(suggestedTasks)
      .set({
        status: "dismissed",
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(suggestedTasks.sourceItemId, itemId),
          eq(suggestedTasks.status, "suggested")
        )
      );

    return NextResponse.json({ dismissed: true });
  } catch (error) {
    console.error("[Tasks API] Failed to dismiss tasks:", error);
    return NextResponse.json(
      { error: "Failed to dismiss tasks" },
      { status: 500 }
    );
  }
}
