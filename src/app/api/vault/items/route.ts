import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listRecentVaultItems,
  searchVaultItems,
  createVaultItem,
} from "@/lib/vault";
import { classifyVaultItem } from "@/lib/vault/classify";

/**
 * GET /api/vault/items — List or search vault items
 *
 * Query params:
 *   q    — search query (triggers full-text search)
 *   tags — comma-separated tag filter
 *   type — type filter
 *
 * Returns { items: VaultItem[] }
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const tags = searchParams.get("tags");
    const type = searchParams.get("type");

    let items;

    if (q) {
      // Full-text search with optional filters
      const filters: { tags?: string[]; type?: string } = {};
      if (tags) filters.tags = tags.split(",").map((t) => t.trim());
      if (type) filters.type = type;

      items = await searchVaultItems(q, filters);
    } else {
      // List recent items (default 20)
      items = await listRecentVaultItems(20);

      // Apply client-side tag/type filtering on recent items
      if (tags) {
        const tagList = tags.split(",").map((t) => t.trim());
        items = items.filter((item) =>
          tagList.some((tag) => item.tags.includes(tag))
        );
      }
      if (type) {
        items = items.filter((item) => item.type === type);
      }
    }

    // Strip content from sensitive items in list view
    const safeItems = items.map((item) => {
      if (item.sensitive) {
        return { ...item, content: null };
      }
      return item;
    });

    return NextResponse.json({ items: safeItems });
  } catch (error) {
    console.error("[Vault API] List error:", error);
    return NextResponse.json(
      { error: "Failed to list vault items" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/vault/items — Create a vault item directly
 *
 * Body: { content, title?, type?, sensitive?, tags?, sourceUrl? }
 *
 * Runs classification, merges tags, creates item.
 * Returns { item: VaultItem }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { content, title, type, sensitive, tags, sourceUrl } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Run classification
    const classification = await classifyVaultItem(content, {
      title,
      type,
      sensitive,
    });

    // Merge user-provided tags with classified tags (deduplicated)
    const mergedTags = Array.from(
      new Set([...(tags || []), ...classification.tags])
    );

    const item = await createVaultItem({
      title: title || classification.title,
      content,
      type: (type || classification.type) as
        | "document"
        | "fact"
        | "credential"
        | "reference",
      sensitive: sensitive ?? classification.sensitive,
      tags: mergedTags,
      sourceUrl: sourceUrl || null,
    });

    return NextResponse.json({ item });
  } catch (error) {
    console.error("[Vault API] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create vault item" },
      { status: 500 }
    );
  }
}
