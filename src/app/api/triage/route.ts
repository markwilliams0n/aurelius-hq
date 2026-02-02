import { NextResponse } from "next/server";
import { generateFakeInboxItems, getTriageQueue } from "@/lib/triage/fake-data";

// In-memory store for development (will be replaced with database)
// Using a module-level variable to persist between requests
let inboxItems = generateFakeInboxItems();

// Get the in-memory items (exported for use by other routes)
export function getInboxItems() {
  return inboxItems;
}

// Update an item in the store
export function updateInboxItem(id: string, updates: Partial<typeof inboxItems[0]>) {
  inboxItems = inboxItems.map((item) =>
    item.externalId === id ? { ...item, ...updates } : item
  );
  return inboxItems.find((item) => item.externalId === id);
}

// Reset the store (useful for testing)
export function resetInboxItems() {
  inboxItems = generateFakeInboxItems();
  return inboxItems;
}

// GET /api/triage - List triage items
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "new";
  const connector = searchParams.get("connector");
  const limit = parseInt(searchParams.get("limit") || "50");

  let filtered = inboxItems.filter((item) => item.status === status);

  if (connector) {
    filtered = filtered.filter((item) => item.connector === connector);
  }

  // Sort by priority then date
  const queue = getTriageQueue(filtered);

  return NextResponse.json({
    items: queue.slice(0, limit),
    total: queue.length,
    stats: {
      new: inboxItems.filter((i) => i.status === "new").length,
      archived: inboxItems.filter((i) => i.status === "archived").length,
      snoozed: inboxItems.filter((i) => i.status === "snoozed").length,
      actioned: inboxItems.filter((i) => i.status === "actioned").length,
    },
  });
}

// POST /api/triage - Reset with fresh fake data (for development)
export async function POST() {
  const items = resetInboxItems();
  return NextResponse.json({
    message: "Inbox reset with fresh fake data",
    count: items.length,
  });
}
