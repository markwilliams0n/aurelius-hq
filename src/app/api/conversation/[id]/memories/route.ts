import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, facts, entities } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Get conversation
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Extract fact IDs from conversation messages
  const messages = (conversation.messages as Array<{
    role: string;
    content: string;
    memories?: Array<{ factId: string; content: string }>;
  }>) || [];

  const createdFactIds = messages
    .flatMap((m) => m.memories || [])
    .map((m) => m.factId);

  // Get facts created in this conversation
  let createdMemories: Array<{
    id: string;
    entityName: string;
    content: string;
    category: string;
    createdAt: string;
    source: string;
  }> = [];

  if (createdFactIds.length > 0) {
    const createdFacts = await db
      .select({
        id: facts.id,
        content: facts.content,
        category: facts.category,
        createdAt: facts.createdAt,
        sourceType: facts.sourceType,
        entityId: facts.entityId,
      })
      .from(facts)
      .where(inArray(facts.id, createdFactIds));

    // Get entity names
    const entityIds = [...new Set(createdFacts.map((f) => f.entityId).filter(Boolean))] as string[];
    const entityList = entityIds.length > 0
      ? await db
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, entityIds))
      : [];

    const entityMap = new Map(entityList.map((e) => [e.id, e.name]));

    createdMemories = createdFacts.map((f) => ({
      id: f.id,
      entityName: f.entityId ? entityMap.get(f.entityId) || "Unknown" : "Unknown",
      content: f.content,
      category: f.category || "context",
      createdAt: f.createdAt.toISOString(),
      source: f.sourceType || "chat",
    }));
  }

  // For "used" memories, we'll show facts that were retrieved for context
  // Since we don't track this directly, we'll leave this empty for now
  // Could be enhanced later to track which facts were used in memory context
  const usedMemories: typeof createdMemories = [];

  return NextResponse.json({
    created: createdMemories,
    used: usedMemories,
  });
}
