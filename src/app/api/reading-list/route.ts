import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

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
