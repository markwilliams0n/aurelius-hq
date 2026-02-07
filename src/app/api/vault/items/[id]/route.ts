import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getVaultItem, updateVaultItem } from "@/lib/vault";

/**
 * GET /api/vault/items/[id] — Get a single vault item
 *
 * If sensitive, content is stripped (use /reveal endpoint instead).
 * Returns { item: VaultItem }
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
    const item = await getVaultItem(id);

    if (!item) {
      return NextResponse.json(
        { error: "Vault item not found" },
        { status: 404 }
      );
    }

    // Strip content from sensitive items
    if (item.sensitive) {
      return NextResponse.json({ item: { ...item, content: null } });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("[Vault API] Get item error:", error);
    return NextResponse.json(
      { error: "Failed to get vault item" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/vault/items/[id] — Update a vault item
 *
 * Body: { title?, tags?, sensitive?, type? }
 * Returns { item: VaultItem }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { title, tags, sensitive, type } = body;

    // Build updates object with only provided fields
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (tags !== undefined) updates.tags = tags;
    if (sensitive !== undefined) updates.sensitive = sensitive;
    if (type !== undefined) updates.type = type;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No update fields provided" },
        { status: 400 }
      );
    }

    const item = await updateVaultItem(id, updates);

    if (!item) {
      return NextResponse.json(
        { error: "Vault item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("[Vault API] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update vault item" },
      { status: 500 }
    );
  }
}
