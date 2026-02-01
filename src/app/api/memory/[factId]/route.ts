import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteFact, getFact } from "@/lib/memory/facts";
import { logActivity } from "@/lib/activity";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ factId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { factId } = await params;

  // Get fact before deleting
  const fact = await getFact(factId);

  if (!fact) {
    return NextResponse.json({ error: "Fact not found" }, { status: 404 });
  }

  // Delete the fact
  await deleteFact(factId);

  await logActivity({
    eventType: "memory_deleted",
    actor: "user",
    description: `Removed memory: ${fact.content}`,
    metadata: {
      factId,
      content: fact.content,
    },
  });

  return NextResponse.json({ success: true });
}
