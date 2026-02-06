import { promises as fs } from 'fs';
import path from 'path';
import { emitMemoryEvent } from './events';
import { getMemoryContext } from './supermemory';

export interface BuildContextOptions {
  /** Maximum number of results */
  limit?: number;
}

/**
 * Build memory context string for AI prompts.
 * Queries Supermemory for profile facts and relevant memories,
 * then formats them into a markdown string.
 *
 * Note: For recent daily notes (last 24h), use getRecentNotes() instead.
 * This function provides long-term memory via Supermemory.
 */
export async function buildMemoryContext(
  query: string,
  options: BuildContextOptions = {}
): Promise<string | null> {
  const startTime = Date.now();

  try {
    const profile = await getMemoryContext(query);
    const durationMs = Date.now() - startTime;

    const hasStatic = profile.profile.static && profile.profile.static.length > 0;
    const hasDynamic = profile.profile.dynamic && profile.profile.dynamic.length > 0;

    if (!hasStatic && !hasDynamic) {
      emitMemoryEvent({
        eventType: 'search',
        trigger: 'chat',
        summary: `Supermemory: no results for "${query.slice(0, 60)}"`,
        payload: { query, resultCount: 0 },
        durationMs,
        metadata: { searchType: 'supermemory-profile' },
      }).catch(() => {});
      return null;
    }

    const staticCount = profile.profile.static?.length ?? 0;
    const dynamicCount = profile.profile.dynamic?.length ?? 0;

    emitMemoryEvent({
      eventType: 'search',
      trigger: 'chat',
      summary: `Supermemory: ${staticCount} profile facts, ${dynamicCount} relevant memories for "${query.slice(0, 60)}"`,
      payload: {
        query,
        resultCount: staticCount + dynamicCount,
        staticCount,
        dynamicCount,
      },
      durationMs,
      metadata: { searchType: 'supermemory-profile' },
    }).catch(() => {});

    const lines: string[] = [];

    if (hasStatic) {
      lines.push('**[Profile]**');
      for (const fact of profile.profile.static) {
        lines.push(`- ${fact}`);
      }
      lines.push('');
    }

    if (hasDynamic) {
      lines.push('**[Relevant Memories]**');
      for (const memory of profile.profile.dynamic) {
        lines.push(`- ${memory}`);
      }
      lines.push('');
    }

    return lines.length > 0 ? lines.join('\n').trim() : null;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    emitMemoryEvent({
      eventType: 'search',
      trigger: 'chat',
      summary: `Supermemory: error for "${query.slice(0, 60)}"`,
      payload: { query, resultCount: 0, error: String(error) },
      durationMs,
      metadata: { searchType: 'supermemory-profile' },
    }).catch(() => {});
    console.error('Supermemory context error:', error);
    return null;
  }
}

/**
 * Get all memory for display in memory browser
 * Reads from file-based memory (life/ directory)
 */
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
  const LIFE_DIR = path.join(process.cwd(), 'life');
  const result: Array<{
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
  }> = [];

  // Scan entity directories
  const entityDirs = [
    { path: 'areas/people', type: 'person' },
    { path: 'areas/companies', type: 'company' },
    { path: 'projects', type: 'project' },
    { path: 'resources', type: 'resource' },
  ];

  for (const { path: entityPath, type } of entityDirs) {
    const dirPath = path.join(LIFE_DIR, entityPath);

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('_')) {
          const entityDir = path.join(dirPath, item.name);

          // Try to read summary.md
          let summary: string | null = null;
          try {
            const summaryContent = await fs.readFile(
              path.join(entityDir, 'summary.md'),
              'utf-8'
            );
            // Extract summary from markdown
            const match = summaryContent.match(/## Summary\n\n([\s\S]*?)(?=\n##|$)/);
            summary = match ? match[1].trim() : summaryContent.slice(0, 200);
          } catch {
            // No summary file
          }

          // Try to read items.json for facts
          const facts: Array<{
            id: string;
            content: string;
            category: string | null;
            createdAt: Date;
          }> = [];

          try {
            const itemsContent = await fs.readFile(
              path.join(entityDir, 'items.json'),
              'utf-8'
            );
            const items = JSON.parse(itemsContent);
            for (const item of items) {
              facts.push({
                id: item.id || `${item.name}-${facts.length}`,
                content: item.fact || item.content || '',
                category: item.category || null,
                createdAt: item.timestamp ? new Date(item.timestamp) : new Date(),
              });
            }
          } catch {
            // No items file
          }

          result.push({
            entity: {
              id: `${entityPath}/${item.name}`,
              name: item.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              type,
              summary,
            },
            facts,
          });
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return result;
}
