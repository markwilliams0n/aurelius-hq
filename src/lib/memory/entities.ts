import { db } from "@/lib/db";
import { entities, type Entity, type NewEntity } from "@/lib/db/schema";
import { eq, ilike, sql } from "drizzle-orm";
import { embed } from "@/lib/ai/embeddings";

// Find entity by name (case-insensitive)
export async function findEntityByName(
  name: string,
  type?: string
): Promise<Entity | null> {
  const conditions = [ilike(entities.name, name)];
  if (type) {
    conditions.push(eq(entities.type, type as any));
  }

  const results = await db
    .select()
    .from(entities)
    .where(sql`${entities.name} ILIKE ${name}`)
    .limit(1);

  return results[0] || null;
}

// Create or update an entity
export async function upsertEntity(
  name: string,
  type: "person" | "project" | "topic" | "company" | "team" | "document",
  metadata?: Record<string, unknown>
): Promise<Entity> {
  // Check if entity exists
  const existing = await findEntityByName(name, type);

  if (existing) {
    // Update metadata if provided
    if (metadata) {
      const [updated] = await db
        .update(entities)
        .set({
          metadata: { ...(existing.metadata as object), ...metadata },
          updatedAt: new Date(),
        })
        .where(eq(entities.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  // Create new entity
  const [created] = await db
    .insert(entities)
    .values({
      name,
      type,
      metadata: metadata || {},
    })
    .returning();

  return created;
}

// Update entity summary with embedding
export async function updateEntitySummary(
  entityId: string,
  summary: string
): Promise<Entity> {
  const embedding = await embed(summary);

  const [updated] = await db
    .update(entities)
    .set({
      summary,
      summaryEmbedding: embedding,
      updatedAt: new Date(),
    })
    .where(eq(entities.id, entityId))
    .returning();

  return updated;
}

// Search entities by semantic similarity
export async function searchEntities(
  query: string,
  limit: number = 5
): Promise<Entity[]> {
  const queryEmbedding = await embed(query);

  const results = await db.execute(sql`
    SELECT *,
      1 - (summary_embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
    FROM entities
    WHERE summary_embedding IS NOT NULL
    ORDER BY summary_embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${limit}
  `);

  return results as unknown as Entity[];
}

// Get entity by ID
export async function getEntity(id: string): Promise<Entity | null> {
  const results = await db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);

  return results[0] || null;
}

// List all entities of a type
export async function listEntities(
  type?: string,
  limit: number = 50
): Promise<Entity[]> {
  if (type) {
    return db
      .select()
      .from(entities)
      .where(eq(entities.type, type as any))
      .limit(limit);
  }
  return db.select().from(entities).limit(limit);
}
