import { NextResponse } from "next/server";
import { inboxItems } from "@/lib/db/schema";
import { generateCardId, createCard } from "@/lib/action-cards/db";
import { fetchViewerContext, getOwnerUserId } from "@/lib/linear/issues";
import { findInboxItem } from "@/lib/gmail/queries";

// Side-effect import: registers the linear:create-issue handler
import "@/lib/action-cards/handlers/linear";

/**
 * Build a description pre-filled with triage context.
 */
function buildDescription(item: typeof inboxItems.$inferSelect): string {
  const lines: string[] = [];

  lines.push(`Source: ${item.connector} from ${item.senderName || item.sender}`);

  if (item.subject) {
    lines.push(`Subject: ${item.subject}`);
  }

  lines.push(""); // blank line

  const enrichment = item.enrichment as Record<string, unknown> | null;
  const summary = enrichment?.summary as string | undefined;

  if (summary) {
    lines.push(summary);
  } else if (item.content) {
    lines.push(item.content.slice(0, 500));
  }

  return lines.join("\n");
}

/**
 * POST /api/triage/[id]/quick-task
 *
 * Creates a pre-filled Linear issue action card from a triage item.
 * Returns the card data for client-side rendering.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Find the triage item
    const item = await findInboxItem(id);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // 2. Fetch Linear viewer context for defaults
    const viewerContext = await fetchViewerContext();
    const ownerId = getOwnerUserId();

    // Default to PER team, fallback to first available team
    const perTeam = viewerContext.teams.find((t) => t.key === "PER");
    const defaultTeam = perTeam || viewerContext.teams[0];

    if (!defaultTeam) {
      return NextResponse.json(
        { error: "No Linear teams available" },
        { status: 500 }
      );
    }

    // Determine assignee: owner (human) or viewer (agent)
    const assigneeId = ownerId || viewerContext.viewer.id;
    const assigneeName = ownerId
      ? "Mark" // Owner is the human
      : viewerContext.viewer.name;

    // 3. Create and persist the action card
    const cardId = generateCardId();
    const card = await createCard({
      id: cardId,
      pattern: "approval",
      handler: "linear:create-issue",
      title: "Create task",
      status: "pending",
      data: {
        title: "", // blank -- user fills this in
        description: buildDescription(item),
        teamId: defaultTeam.id,
        teamName: defaultTeam.name,
        assigneeId,
        assigneeName,
        priority: 0, // None -- user can cycle
        sourceItemId: item.id,
      },
    });

    return NextResponse.json({ card });
  } catch (error) {
    console.error("[Quick Task] Error creating card:", error);
    return NextResponse.json(
      { error: "Failed to create task card" },
      { status: 500 }
    );
  }
}
