import { NextResponse } from "next/server";
import { getTriageQueue } from "@/lib/triage/queue";
import { db } from "@/lib/db";
import { inboxItems as inboxItemsTable, suggestedTasks } from "@/lib/db/schema";
import { eq, desc, and, lt, sql, inArray } from "drizzle-orm";
import { getBatchCardsWithItems } from "@/lib/triage/batch-cards";

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

  // Fetch filtered items, stats, sender counts, and batch cards in parallel
  const [dbItems, statsRows, senderCountRows, batchCards] = await Promise.all([
    getInboxItemsFromDb({
      status,
      connector: connector || undefined,
      limit,
    }),
    // Single GROUP BY query for stats instead of fetching all items
    db
      .select({
        status: inboxItemsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItemsTable)
      .groupBy(inboxItemsTable.status),
    // Sender counts for "new" items — enables "X more from this sender"
    db
      .select({
        sender: inboxItemsTable.sender,
        connector: inboxItemsTable.connector,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.status, "new"))
      .groupBy(inboxItemsTable.sender, inboxItemsTable.connector),
    // Batch cards with their items
    getBatchCardsWithItems(),
  ]);

  // Sort by priority then date
  const queue = getTriageQueue(dbItems);

  // Build stats from aggregated counts
  const statsByStatus: Record<string, number> = {};
  for (const row of statsRows) {
    statsByStatus[row.status] = row.count;
  }

  // Batch-fetch all suggested tasks for the items we're returning
  const limitedQueue = queue.slice(0, limit);
  const itemIds = limitedQueue.map((item) => item.id);
  const allTasks = itemIds.length > 0
    ? await db
        .select()
        .from(suggestedTasks)
        .where(
          and(
            inArray(suggestedTasks.sourceItemId, itemIds as string[]),
            eq(suggestedTasks.status, "suggested")
          )
        )
    : [];

  // Build a map from DB id to display id (externalId || id)
  // item.id is always present (primary key) but drizzle types it as possibly undefined
  const dbIdToDisplayId: Record<string, string> = {};
  for (const item of limitedQueue) {
    if (!item.id) continue;
    dbIdToDisplayId[item.id] = item.externalId ?? item.id;
  }

  // Group tasks by display ID so the client can look them up directly
  const tasksByItemId: Record<string, typeof allTasks> = {};
  for (const task of allTasks) {
    const sourceId = task.sourceItemId;
    if (!sourceId) continue;
    const displayId = dbIdToDisplayId[sourceId] ?? sourceId;
    if (!tasksByItemId[displayId]) {
      tasksByItemId[displayId] = [];
    }
    tasksByItemId[displayId].push(task);
  }

  // Build sender counts map: "connector:sender" → count (excluding current item)
  const senderCounts: Record<string, number> = {};
  for (const row of senderCountRows) {
    if (row.count > 1) {
      senderCounts[`${row.connector}:${row.sender}`] = row.count - 1;
    }
  }

  return NextResponse.json({
    items: queue.slice(0, limit),
    total: queue.length,
    tasksByItemId,
    senderCounts,
    batchCards,
    stats: {
      new: statsByStatus["new"] || 0,
      archived: statsByStatus["archived"] || 0,
      snoozed: statsByStatus["snoozed"] || 0,
      actioned: statsByStatus["actioned"] || 0,
    },
  });
}

