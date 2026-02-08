import { db } from "@/lib/db";
import {
  vaultItems,
  type VaultItem,
  type NewVaultItem,
} from "@/lib/db/schema/vault";
import { eq, desc, sql, and, arrayContains } from "drizzle-orm";

/** Create a new vault item */
export async function createVaultItem(
  item: Omit<NewVaultItem, "id" | "createdAt" | "updatedAt">
): Promise<VaultItem> {
  const [created] = await db.insert(vaultItems).values(item).returning();
  return created;
}

/** Get a vault item by ID */
export async function getVaultItem(id: string): Promise<VaultItem | null> {
  const [item] = await db
    .select()
    .from(vaultItems)
    .where(eq(vaultItems.id, id))
    .limit(1);
  return item ?? null;
}

/** Get a vault item by ID, including sensitive content (for reveal endpoint only) */
export async function getVaultItemForReveal(
  id: string
): Promise<{ content: string | null; title: string; type: string } | null> {
  const [item] = await db
    .select({
      content: vaultItems.content,
      title: vaultItems.title,
      type: vaultItems.type,
    })
    .from(vaultItems)
    .where(and(eq(vaultItems.id, id), eq(vaultItems.sensitive, true)))
    .limit(1);
  return item ?? null;
}

/** List recent vault items */
export async function listRecentVaultItems(
  limit: number = 20
): Promise<VaultItem[]> {
  return db
    .select()
    .from(vaultItems)
    .orderBy(desc(vaultItems.createdAt))
    .limit(limit);
}

/** Full-text search vault items */
export async function searchVaultItems(
  query: string,
  filters?: { tags?: string[]; type?: string }
): Promise<VaultItem[]> {
  const conditions = [
    sql`to_tsvector('english', ${vaultItems.title} || ' ' || COALESCE(${vaultItems.content}, '')) @@ plainto_tsquery('english', ${query})`,
  ];

  if (filters?.tags?.length) {
    conditions.push(arrayContains(vaultItems.tags, filters.tags));
  }
  if (filters?.type) {
    conditions.push(eq(vaultItems.type, filters.type as any));
  }

  return db
    .select()
    .from(vaultItems)
    .where(and(...conditions))
    .orderBy(desc(vaultItems.createdAt))
    .limit(20);
}

/** Update a vault item */
export async function updateVaultItem(
  id: string,
  updates: Partial<
    Pick<
      VaultItem,
      | "title"
      | "tags"
      | "sensitive"
      | "type"
      | "content"
      | "supermemoryStatus"
      | "supermemoryLevel"
      | "supermemorySummary"
    >
  >
): Promise<VaultItem | null> {
  const [updated] = await db
    .update(vaultItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(vaultItems.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Find a duplicate vault item by fuzzy title match.
 * Returns the best match if similarity is above threshold.
 */
export async function findDuplicateVaultItem(
  title: string,
  content: string,
): Promise<VaultItem | null> {
  // Search by the main keywords from the title
  const keywords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) return null;

  // Use full-text search with the title keywords
  const query = keywords.join(" & ");
  try {
    const candidates = await db
      .select()
      .from(vaultItems)
      .where(
        sql`to_tsvector('english', ${vaultItems.title} || ' ' || COALESCE(${vaultItems.content}, '')) @@ to_tsquery('english', ${query})`
      )
      .orderBy(desc(vaultItems.createdAt))
      .limit(5);

    if (candidates.length === 0) return null;

    // Score each candidate by word overlap with title + content
    const inputWords = new Set(
      `${title} ${content}`.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2)
    );

    let bestMatch: VaultItem | null = null;
    let bestScore = 0;

    for (const item of candidates) {
      const itemWords = new Set(
        `${item.title} ${item.content || ""}`.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2)
      );
      const intersection = [...inputWords].filter((w) => itemWords.has(w)).length;
      const union = new Set([...inputWords, ...itemWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard > bestScore) {
        bestScore = jaccard;
        bestMatch = item;
      }
    }

    // Threshold: 0.4 Jaccard similarity means significant overlap
    return bestScore >= 0.4 ? bestMatch : null;
  } catch {
    // FTS query might fail on edge cases — not critical, skip dedup
    return null;
  }
}

/** Get all unique tags across vault items */
export async function getAllTags(): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT DISTINCT unnest(tags) as tag FROM vault_items ORDER BY tag`
  );
  const rows = result as unknown as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

/** Delete a vault item by ID */
export async function deleteVaultItem(id: string): Promise<boolean> {
  const result = await db.delete(vaultItems).where(eq(vaultItems.id, id)).returning();
  return result.length > 0;
}
