import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVaultItemForReveal } from "@/lib/vault";

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
