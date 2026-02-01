import { searchFacts } from "./facts";
import { searchEntities, getEntity } from "./entities";
import { db } from "@/lib/db";
import { facts, entities } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// Build memory context string for a query
export async function buildMemoryContext(
  query: string,
  limit: number = 5
): Promise<string | null> {
  // Search for relevant facts
  const relevantFacts = await searchFacts(query, limit);

  if (relevantFacts.length === 0) {
    return null;
  }

  // Group facts by entity
  const factsByEntity: Record<
    string,
    {
      entityName: string;
      entityType: string;
      facts: string[];
    }
  > = {};

  for (const fact of relevantFacts) {
    if (!fact.entityId) continue;

    if (!factsByEntity[fact.entityId]) {
      const entity = await getEntity(fact.entityId);
      if (entity) {
        factsByEntity[fact.entityId] = {
          entityName: entity.name,
          entityType: entity.type,
          facts: [],
        };
      }
    }

    if (factsByEntity[fact.entityId]) {
      factsByEntity[fact.entityId].facts.push(fact.content);
    }
  }

  // Format as context string
  const lines: string[] = [];

  for (const entityData of Object.values(factsByEntity)) {
    lines.push(`**${entityData.entityName}** (${entityData.entityType}):`);
    for (const factContent of entityData.facts) {
      lines.push(`  - ${factContent}`);
    }
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n").trim() : null;
}

// Get all memory for display in memory browser
export async function getAllMemory(): Promise<
  Array<{
    entity: {
      id: string;
      name: string;
      type: string;
      summary: string | null;
    };
    facts: Array<{
      id: string;
      content: string;
      category: string | null;
      createdAt: Date;
    }>;
  }>
> {
  const allEntities = await db.select().from(entities);

  const result = [];

  for (const entity of allEntities) {
    const entityFacts = await db
      .select()
      .from(facts)
      .where(eq(facts.entityId, entity.id))
      .orderBy(sql`created_at DESC`);

    result.push({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        summary: entity.summary,
      },
      facts: entityFacts.map((f) => ({
        id: f.id,
        content: f.content,
        category: f.category,
        createdAt: f.createdAt,
      })),
    });
  }

  return result;
}
