/**
 * Access tracking for memory entities
 * Tracks when entities are accessed and updates their items.json
 */

import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');

interface EntityFact {
  id: string;
  fact: string;
  category: string;
  timestamp: string;
  source: string;
  status: 'active' | 'superseded';
  supersededBy: string | null;
  relatedEntities: string[];
  lastAccessed: string;
  accessCount: number;
}

/**
 * Extract entity path from a search result path
 * e.g., "life/areas/people/john-doe/summary.md" -> "areas/people/john-doe"
 */
function extractEntityPath(searchPath: string): string | null {
  // Remove "life/" prefix if present
  let p = searchPath.replace(/^life\//, '');

  // Remove filename if present
  p = p.replace(/\/[^/]+\.(md|json)$/, '');

  // Check if this looks like an entity path
  if (p.match(/^(areas\/people|areas\/companies|projects|resources)\/[^/]+$/)) {
    return p;
  }

  return null;
}

/**
 * Record an access to an entity
 * Updates lastAccessed timestamp and increments accessCount for all facts
 */
export async function recordEntityAccess(searchPath: string): Promise<void> {
  const entityPath = extractEntityPath(searchPath);
  if (!entityPath) return;

  const itemsPath = path.join(LIFE_DIR, entityPath, 'items.json');

  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    const facts: EntityFact[] = JSON.parse(content);

    const now = new Date().toISOString();
    const updatedFacts = facts.map(f => ({
      ...f,
      lastAccessed: now,
      accessCount: (f.accessCount || 0) + 1,
    }));

    await fs.writeFile(itemsPath, JSON.stringify(updatedFacts, null, 2));
  } catch {
    // Entity doesn't have items.json or doesn't exist - ignore
  }
}

/**
 * Record access to multiple entities from search results
 */
export async function recordSearchAccess(paths: string[]): Promise<void> {
  // Deduplicate entity paths
  const entityPaths = new Set<string>();
  for (const p of paths) {
    const entityPath = extractEntityPath(p);
    if (entityPath) {
      entityPaths.add(entityPath);
    }
  }

  // Record access for each unique entity
  await Promise.all(
    Array.from(entityPaths).map(p =>
      recordEntityAccess(`life/${p}/summary.md`)
    )
  );
}

/**
 * Get access statistics for an entity
 */
export async function getEntityAccessStats(entityPath: string): Promise<{
  totalAccesses: number;
  lastAccessed: string | null;
  factCount: number;
} | null> {
  const itemsPath = path.join(LIFE_DIR, entityPath, 'items.json');

  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    const facts: EntityFact[] = JSON.parse(content);

    if (facts.length === 0) {
      return { totalAccesses: 0, lastAccessed: null, factCount: 0 };
    }

    const totalAccesses = facts.reduce((sum, f) => sum + (f.accessCount || 0), 0);
    const lastAccessed = facts
      .map(f => f.lastAccessed)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    return {
      totalAccesses,
      lastAccessed,
      factCount: facts.length,
    };
  } catch {
    return null;
  }
}
