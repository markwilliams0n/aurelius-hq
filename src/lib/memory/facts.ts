import { db } from "@/lib/db";
import { facts, type Fact, type NewFact } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { embed } from "@/lib/ai/embeddings";

// Create a new fact with embedding
export async function createFact(
  entityId: string,
  content: string,
  category: "preference" | "relationship" | "status" | "context" | "milestone",
  sourceType: "chat" | "document" | "manual" = "chat",
  sourceId?: string
): Promise<Fact> {
  const embedding = await embed(content);

  const [created] = await db
    .insert(facts)
    .values({
      entityId,
      content,
      embedding,
      category,
      sourceType,
      sourceId,
    })
    .returning();

  return created;
}

// Supersede a fact (mark old as superseded, create new)
export async function supersedeFact(
  oldFactId: string,
  newContent: string
): Promise<Fact> {
  // Get the old fact
  const [oldFact] = await db
    .select()
    .from(facts)
    .where(eq(facts.id, oldFactId))
    .limit(1);

  if (!oldFact) {
    throw new Error(`Fact ${oldFactId} not found`);
  }

  // Create new fact
  const newFact = await createFact(
    oldFact.entityId!,
    newContent,
    oldFact.category as any,
    oldFact.sourceType as any,
    oldFact.sourceId || undefined
  );

  // Mark old fact as superseded
  await db
    .update(facts)
    .set({
      status: "superseded",
      supersededBy: newFact.id,
    })
    .where(eq(facts.id, oldFactId));

  return newFact;
}

// Delete a fact (for undo)
export async function deleteFact(factId: string): Promise<void> {
  await db.delete(facts).where(eq(facts.id, factId));
}

// Get facts for an entity
export async function getEntityFacts(
  entityId: string,
  activeOnly: boolean = true
): Promise<Fact[]> {
  const conditions = [eq(facts.entityId, entityId)];
  if (activeOnly) {
    conditions.push(eq(facts.status, "active"));
  }

  return db
    .select()
    .from(facts)
    .where(and(...conditions))
    .orderBy(facts.createdAt);
}

// Search facts by semantic similarity
export async function searchFacts(
  query: string,
  limit: number = 10
): Promise<Array<Fact & { similarity: number }>> {
  const queryEmbedding = await embed(query);

  const results = await db.execute(sql`
    SELECT *,
      1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
    FROM facts
    WHERE embedding IS NOT NULL
      AND status = 'active'
    ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${limit}
  `);

  return results as unknown as Array<Fact & { similarity: number }>;
}

// Get recent facts
export async function getRecentFacts(limit: number = 20): Promise<Fact[]> {
  return db
    .select()
    .from(facts)
    .where(eq(facts.status, "active"))
    .orderBy(sql`created_at DESC`)
    .limit(limit);
}

// Get fact by ID
export async function getFact(id: string): Promise<Fact | null> {
  const results = await db
    .select()
    .from(facts)
    .where(eq(facts.id, id))
    .limit(1);

  return results[0] || null;
}
