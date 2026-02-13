import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { processScrapedBookmarks, type ScrapedBookmark } from "@/lib/reading-list/x-bookmarks";
import { summarizeBookmark } from "@/lib/reading-list/summarize";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tag = url.searchParams.get("tag");

  try {
    const conditions = [];

    if (status) {
      conditions.push(eq(readingList.status, status as any));
    } else {
      // Default: show unread + read (not archived)
      conditions.push(
        inArray(readingList.status, ["unread", "read"])
      );
    }

    const items = await db
      .select()
      .from(readingList)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(readingList.createdAt));

    // Filter by tag in JS (text[] not great for SQL filtering)
    const filtered = tag
      ? items.filter((item) => item.tags?.includes(tag))
      : items;

    return NextResponse.json({ items: filtered });
  } catch (error) {
    console.error("[Reading List API] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading list" },
      { status: 500 }
    );
  }
}

// POST /api/reading-list
// Accepts either:
//   { bookmarks: ScrapedBookmark[] }  — batch X bookmark import
//   { item: { url, title, content } } — single item from any page
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Single item from bookmarklet (any page)
    if (body.item) {
      const { url, title, content } = body.item as {
        url: string;
        title: string;
        content?: string;
      };

      if (!url) {
        return NextResponse.json(
          { error: "item.url is required" },
          { status: 400 }
        );
      }

      // Dedupe by URL for manual items
      const existing = await db
        .select({ id: readingList.id })
        .from(readingList)
        .where(eq(readingList.sourceId, url))
        .limit(1);

      if (existing.length > 0) {
        return NextResponse.json({ added: 0, skipped: 1 });
      }

      const textToSummarize = content || title;
      const { summary, tags } = await summarizeBookmark(textToSummarize, title);

      await db.insert(readingList).values({
        source: "manual",
        sourceId: url,
        url,
        title: title || url,
        content: content || null,
        summary,
        tags,
        rawPayload: body.item,
      });

      return NextResponse.json({ added: 1, skipped: 0 }, { status: 201 });
    }

    // Batch X bookmark import
    const { bookmarks } = body as { bookmarks: ScrapedBookmark[] };

    if (!bookmarks || !Array.isArray(bookmarks)) {
      return NextResponse.json(
        { error: "Expected { bookmarks: [...] } or { item: {...} }" },
        { status: 400 }
      );
    }

    const result = await processScrapedBookmarks(bookmarks);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[Reading List API] POST sync failed:", error);
    return NextResponse.json(
      { error: "Failed to process bookmarks" },
      { status: 500 }
    );
  }
}
