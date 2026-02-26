import { emitMemoryEvent } from './events';
import { getMemoryContext, searchMemories } from './supermemory';

export interface BuildContextOptions {
  /** Maximum number of results */
  limit?: number;
}

/**
 * Build memory context string for AI prompts.
 * Queries Supermemory for profile facts, relevant memories, AND
 * direct document search results (to catch items the profile
 * distillation may have missed).
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
    // Run profile and document search in parallel.
    // Profile gives distilled facts; search catches specific documents
    // that may not surface in the profile's fact extraction.
    const [profile, searchResults] = await Promise.all([
      getMemoryContext(query),
      searchMemories(query, 5).catch(() => []),
    ]);
    const durationMs = Date.now() - startTime;

    const hasStatic = profile.profile.static && profile.profile.static.length > 0;
    const hasDynamic = profile.profile.dynamic && profile.profile.dynamic.length > 0;
    const hasSearch = searchResults.length > 0;

    if (!hasStatic && !hasDynamic && !hasSearch) {
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
      summary: `Supermemory: ${staticCount} profile facts, ${dynamicCount} relevant memories, ${searchResults.length} doc matches for "${query.slice(0, 60)}"`,
      payload: {
        query,
        resultCount: staticCount + dynamicCount + searchResults.length,
        staticCount,
        dynamicCount,
        searchCount: searchResults.length,
      },
      durationMs,
      metadata: { searchType: 'supermemory-profile+search' },
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

    // Add document search results — these surface specific documents
    // that the profile's fact distillation may have missed or merged.
    if (hasSearch) {
      lines.push('**[Matched Documents]**');
      for (const doc of searchResults) {
        const title = doc.metadata?.title as string | undefined;
        const date = doc.metadata?.date as string | undefined;
        // Content lives in chunks[].content, not top-level
        const chunks = (doc as unknown as Record<string, unknown>).chunks as Array<{ content?: string }> | undefined;
        const content = (chunks?.[0]?.content || '').slice(0, 500);
        const header = [title, date].filter(Boolean).join(' — ');
        if (header) {
          lines.push(`- **${header}**: ${content}`);
        } else if (content) {
          lines.push(`- ${content}`);
        }
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
