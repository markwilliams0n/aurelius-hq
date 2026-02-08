import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  generateSummary,
  sendToSupermemory,
  type SummaryLevel,
} from "@/lib/vault/supermemory";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/vault/items/[id]/supermemory
 *
 * action=preview → generates summary preview at given level
 * action=send    → sends summary to SuperMemory (uses editedSummary if provided)
 *
 * Body: { action: "preview" | "send", level: SummaryLevel, summary?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 });
    }
    const { action, level, summary: editedSummary } = await request.json();

    if (!level || !["short", "medium", "detailed", "full"].includes(level)) {
      return NextResponse.json({ error: "Invalid level" }, { status: 400 });
    }

    if (action === "preview") {
      const summary = await generateSummary(id, level as SummaryLevel);
      return NextResponse.json({ summary });
    }

    if (action === "send") {
      const finalSummary =
        editedSummary || (await generateSummary(id, level as SummaryLevel));
      await sendToSupermemory(id, finalSummary, level as SummaryLevel);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[Vault API] SuperMemory error:", error);
    return NextResponse.json(
      { error: "Failed to process SuperMemory request" },
      { status: 500 }
    );
  }
}
