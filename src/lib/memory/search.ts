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
