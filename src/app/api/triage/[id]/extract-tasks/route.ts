import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { extractAndSaveTasks } from "@/lib/triage/extract-tasks";

// Check if string is a valid UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Find item by id (UUID) or externalId (string)
async function findItem(id: string) {
  if (isUUID(id)) {
    const items = await db
      .select()
      .from(inboxItems)
      .where(or(eq(inboxItems.id, id), eq(inboxItems.externalId, id)))
      .limit(1);
    return items[0];
  } else {
    const items = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);
    return items[0];
  }
}

/**
 * POST /api/triage/[id]/extract-tasks
 *
 * Trigger AI task extraction for a triage item on demand.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const item = await findItem(id);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const content = item.content || item.preview || item.subject || "";

    const result = await extractAndSaveTasks(item.id, content, {
      connector: item.connector,
      sender: item.sender ?? undefined,
      senderName: item.senderName ?? undefined,
      subject: item.subject ?? undefined,
    });

    return NextResponse.json({
      tasks: result.tasks,
      forYou: result.forYou,
      forOthers: result.forOthers,
    });
  } catch (error) {
    console.error("[Extract Tasks] Failed:", error);
    return NextResponse.json(
      { error: "Failed to extract tasks" },
      { status: 500 }
    );
  }
}
