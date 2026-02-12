import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readingList } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { status } = body;

    if (!["unread", "read", "archived"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const result = await db
      .update(readingList)
      .set({ status })
      .where(eq(readingList.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("[Reading List API] PATCH failed:", error);
    return NextResponse.json(
      { error: "Failed to update reading list item" },
      { status: 500 }
    );
  }
}
