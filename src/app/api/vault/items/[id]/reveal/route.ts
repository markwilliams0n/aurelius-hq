import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVaultItemForReveal } from "@/lib/vault";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/vault/items/[id]/reveal — Get sensitive content for display
 *
 * Only works for items marked as sensitive.
 * Returns { content, title }
 */
export async function GET(
  _request: Request,
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
    const result = await getVaultItemForReveal(id);

    if (!result) {
      return NextResponse.json(
        { error: "Item not found or not sensitive" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      content: result.content,
      title: result.title,
    });
  } catch (error) {
    console.error("[Vault API] Reveal error:", error);
    return NextResponse.json(
      { error: "Failed to reveal vault item" },
      { status: 500 }
    );
  }
}
