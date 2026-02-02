import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_MODEL } from "@/lib/ai/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Count facts saved in this conversation's memories
  const messages = (conversation.messages as Array<{
    role: string;
    content: string;
    memories?: Array<{ factId: string; content: string }>;
  }>) || [];

  const factsSaved = messages.reduce((count, msg) => {
    return count + (msg.memories?.length || 0);
  }, 0);

  return NextResponse.json({
    id: conversation.id,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      memories: m.memories,
    })),
    model: DEFAULT_MODEL,
    factsSaved,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Clear the conversation by setting messages to empty array
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (existing) {
    await db
      .update(conversations)
      .set({
        messages: [],
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id));
  }

  return NextResponse.json({ success: true });
}
