import { NextResponse } from "next/server";
import { generateFakeInboxItems, getTriageQueue } from "@/lib/triage/fake-data";
import { db } from "@/lib/db";
import { inboxItems as inboxItemsTable, suggestedTasks } from "@/lib/db/schema";
import { eq, desc, and, or, lt, isNull } from "drizzle-orm";
import { insertInboxItemWithTasks } from "@/lib/triage/insert-with-tasks";

// Wake up snoozed items whose snooze time has passed
async function wakeUpSnoozedItems() {
  const now = new Date();

  // Find snoozed items where snoozedUntil has passed
  await db
    .update(inboxItemsTable)
    .set({
      status: "new",
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(inboxItemsTable.status, "snoozed"),
        lt(inboxItemsTable.snoozedUntil, now)
      )
    );
}

// Fetch inbox items from database
export async function getInboxItemsFromDb(options?: {
  status?: string;
  connector?: string;
  limit?: number;
  includeAll?: boolean; // For stats - include all items regardless of status
}) {
  const conditions = [];

  if (!options?.includeAll) {
    if (options?.status) {
      conditions.push(eq(inboxItemsTable.status, options.status as any));
    }
  }
  if (options?.connector) {
    conditions.push(eq(inboxItemsTable.connector, options.connector as any));
  }

  const query = db
    .select()
    .from(inboxItemsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(inboxItemsTable.receivedAt));

  if (options?.limit) {
    return query.limit(options.limit);
  }

  return query;
}

// GET /api/triage - List triage items
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "new";
  const connector = searchParams.get("connector");
  const limit = parseInt(searchParams.get("limit") || "500");

  // First, wake up any snoozed items whose time has passed
  await wakeUpSnoozedItems();

  // Fetch from database
  const dbItems = await getInboxItemsFromDb({
    status,
    connector: connector || undefined,
    limit,
  });

  // Get all items for stats
  const allItems = await getInboxItemsFromDb({ includeAll: true });

  // Sort by priority then date
  const queue = getTriageQueue(dbItems);

  // Count snoozed items that are still snoozed (not yet woken up)
  const snoozedCount = allItems.filter(
    (i) => i.status === "snoozed" && i.snoozedUntil && new Date(i.snoozedUntil) > new Date()
  ).length;

  return NextResponse.json({
    items: queue.slice(0, limit),
    total: queue.length,
    stats: {
      new: allItems.filter((i) => i.status === "new").length,
      archived: allItems.filter((i) => i.status === "archived").length,
      snoozed: snoozedCount,
      actioned: allItems.filter((i) => i.status === "actioned").length,
    },
  });
}

// POST /api/triage - Reset with fresh fake data (for development)
// NOTE: Does NOT delete gmail items - those come from real Gmail sync
export async function POST() {
  // Clear existing fake items and their tasks (keep real connector data like granola, gmail)
  // Tasks are cascade deleted when inbox items are deleted
  // Gmail is excluded - use real Gmail sync instead of fake data
  await db.delete(inboxItemsTable).where(eq(inboxItemsTable.connector, 'slack'));
  await db.delete(inboxItemsTable).where(eq(inboxItemsTable.connector, 'linear'));
  await db.delete(inboxItemsTable).where(eq(inboxItemsTable.connector, 'manual'));

  // Generate fresh fake data (excluding Gmail - use real sync)
  const allFakeItems = generateFakeInboxItems();
  const fakeItems = allFakeItems.filter(item => item.connector !== 'gmail');

  // Insert fake data - skip AI task extraction for performance
  // Fake data could include simulated tasks later if needed
  for (const item of fakeItems) {
    await insertInboxItemWithTasks(
      {
        connector: item.connector as any,
        externalId: item.externalId,
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        content: item.content,
        preview: item.preview,
        status: item.status as any,
        priority: item.priority as any,
        tags: item.tags,
        receivedAt: item.receivedAt,
        enrichment: item.enrichment,
      },
      { skipAiExtraction: true }
    );
  }

  return NextResponse.json({
    message: "Inbox reset with fresh fake data",
    count: fakeItems.length,
  });
}
