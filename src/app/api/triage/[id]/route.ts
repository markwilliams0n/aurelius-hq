import { NextResponse } from "next/server";
import { getInboxItems, updateInboxItem } from "../route";

// GET /api/triage/[id] - Get single item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const items = getInboxItems();
  const item = items.find((i) => i.externalId === id);

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

  const items = getInboxItems();
  const item = items.find((i) => i.externalId === id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  let updatedItem;

  switch (action) {
    case "archive":
      updatedItem = updateInboxItem(id, {
        status: "archived",
        updatedAt: new Date(),
      });
      break;

    case "snooze":
      const snoozeDuration = actionData.duration || "1h"; // 1h, 4h, 1d, 1w
      const snoozeUntil = calculateSnoozeTime(snoozeDuration);
      updatedItem = updateInboxItem(id, {
        status: "snoozed",
        snoozedUntil: snoozeUntil,
        updatedAt: new Date(),
      });
      break;

    case "flag":
      const currentTags = item.tags || [];
      const newTags = currentTags.includes("flagged")
        ? currentTags.filter((t) => t !== "flagged")
        : [...currentTags, "flagged"];
      updatedItem = updateInboxItem(id, {
        tags: newTags,
        updatedAt: new Date(),
      });
      break;

    case "priority":
      const newPriority = actionData.priority || "high";
      updatedItem = updateInboxItem(id, {
        priority: newPriority,
        updatedAt: new Date(),
      });
      break;

    case "tag":
      const tag = actionData.tag;
      const existingTags = item.tags || [];
      if (!existingTags.includes(tag)) {
        updatedItem = updateInboxItem(id, {
          tags: [...existingTags, tag],
          updatedAt: new Date(),
        });
      } else {
        updatedItem = item;
      }
      break;

    case "actioned":
      updatedItem = updateInboxItem(id, {
        status: "actioned",
        updatedAt: new Date(),
      });
      break;

    case "restore":
      updatedItem = updateInboxItem(id, {
        status: "new",
        snoozedUntil: undefined,
        updatedAt: new Date(),
      });
      break;

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }

  return NextResponse.json({
    success: true,
    action,
    item: updatedItem,
  });
}

// Helper to calculate snooze time
function calculateSnoozeTime(duration: string): Date {
  const now = new Date();

  switch (duration) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
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
