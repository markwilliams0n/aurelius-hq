import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    const items = await db
      .select({
        id: inboxItems.id,
        sender: inboxItems.sender,
        senderName: inboxItems.senderName,
        subject: inboxItems.subject,
        status: inboxItems.status,
        classification: inboxItems.classification,
        createdAt: inboxItems.createdAt,
        updatedAt: inboxItems.updatedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.connector, "gmail"),
          isNotNull(inboxItems.classification)
        )
      )
      .orderBy(desc(inboxItems.createdAt))
      .limit(limit);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[Activity] Failed to fetch:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
