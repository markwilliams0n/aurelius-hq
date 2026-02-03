import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { syncArchiveToGmail, syncSpamToGmail } from "@/lib/gmail/actions";

// Check if string is a valid UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Find item by id (UUID) or externalId (string)
async function findItem(id: string) {
  // Only compare against id column if it's a valid UUID to avoid DB errors
  if (isUUID(id)) {
    const items = await db
      .select()
      .from(inboxItems)
      .where(or(eq(inboxItems.id, id), eq(inboxItems.externalId, id)))
      .limit(1);
    return items[0];
  } else {
    // Not a UUID, only search by externalId
    const items = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);
    return items[0];
  }
}

// GET /api/triage/[id] - Get single item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const item = await findItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}

// POST /api/triage/[id] - Perform action on item
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { action, ...actionData } = body;

  const item = await findItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  let updates: Partial<typeof inboxItems.$inferInsert> = {
    updatedAt: new Date(),
  };

  switch (action) {
    case "archive":
      updates.status = "archived";
      updates.snoozedUntil = null;
      // Sync to Gmail if this is a Gmail item
      console.log(`[Triage] Archive action for item ${item.id}, connector: ${item.connector}`);
      if (item.connector === "gmail") {
        console.log(`[Triage] Syncing archive to Gmail for ${item.id}...`);
        try {
          await syncArchiveToGmail(item.id);
          console.log(`[Triage] Gmail sync complete for ${item.id}`);
        } catch (error) {
          console.error("[Triage] Failed to sync archive to Gmail:", error);
          // Continue with local archive even if Gmail sync fails
        }
      }
      break;

    case "snooze":
      // Accept either snoozeUntil (ISO string) or duration
      let snoozeUntil: Date;
      if (actionData.snoozeUntil) {
        snoozeUntil = new Date(actionData.snoozeUntil);
      } else {
        const duration = actionData.duration || "1h";
        snoozeUntil = calculateSnoozeTime(duration);
      }
      updates.status = "snoozed";
      updates.snoozedUntil = snoozeUntil;
      break;

    case "flag":
      const currentTags = item.tags || [];
      updates.tags = currentTags.includes("flagged")
        ? currentTags.filter((t) => t !== "flagged")
        : [...currentTags, "flagged"];
      break;

    case "priority":
      updates.priority = actionData.priority || "high";
      break;

    case "tag":
      const tag = actionData.tag;
      const existingTags = item.tags || [];
      if (!existingTags.includes(tag)) {
        updates.tags = [...existingTags, tag];
      }
      break;

    case "actioned":
      updates.status = "actioned";
      updates.snoozedUntil = null;
      break;

    case "spam":
      updates.status = "archived";
      updates.snoozedUntil = null;
      // Mark as spam in Gmail if this is a Gmail item
      if (item.connector === "gmail") {
        try {
          await syncSpamToGmail(item.id);
        } catch (error) {
          console.error("[Triage] Failed to mark as spam in Gmail:", error);
          // Continue with local archive even if Gmail sync fails
        }
      }
      break;

    case "restore":
      updates.status = "new";
      updates.snoozedUntil = null;
      break;

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }

  // Update in database
  const [updatedItem] = await db
    .update(inboxItems)
    .set(updates)
    .where(eq(inboxItems.id, item.id))
    .returning();

  return NextResponse.json({
    success: true,
    action,
    item: updatedItem,
  });
}

// Helper to calculate snooze time from duration string
function calculateSnoozeTime(duration: string): Date {
  const now = new Date();

  switch (duration) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "3h":
      return new Date(now.getTime() + 3 * 60 * 60 * 1000);
    case "4h":
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "1d":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "1w":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "tomorrow":
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    case "nextweek":
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
      nextWeek.setHours(9, 0, 0, 0);
      return nextWeek;
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
