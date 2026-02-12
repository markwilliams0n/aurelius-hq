import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { summarizeBookmark } from "./summarize";

export interface ScrapedBookmark {
  tweetId: string;
  author: string;
  content: string;
  url: string;
  timestamp?: string;
}

export async function processScrapedBookmarks(
  bookmarks: ScrapedBookmark[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const bookmark of bookmarks) {
    const existing = await db
      .select({ id: readingList.id })
      .from(readingList)
      .where(eq(readingList.sourceId, bookmark.tweetId))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const { summary, tags } = await summarizeBookmark(
      bookmark.content,
      bookmark.author
    );

    await db.insert(readingList).values({
      source: "x-bookmark",
      sourceId: bookmark.tweetId,
      url: bookmark.url,
      title: `@${bookmark.author}`,
      content: bookmark.content,
      summary,
      tags,
      rawPayload: bookmark,
    });

    added++;
  }

  return { added, skipped };
}
