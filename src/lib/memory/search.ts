import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { recordSearchAccess } from './access-tracking';

export interface SearchResult {
  path: string;
  content: string;
  score: number;
  collection: string;
}

export interface SearchOptions {
  collection?: 'life' | 'memory' | 'me' | 'all';
  limit?: number;
}

/**
 * Search memory using QMD's combined query (BM25 + vector + reranking)
 */
export function searchMemory(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const {
    collection = 'all',
    limit = 10,
  } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `qmd query "${escapedQuery}" ${collectionFlag} -n ${limit} --json`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000 // 30 second timeout
    });

    try {
      const parsed = JSON.parse(result);
      return parsed.map((item: { docid?: string; path?: string; content?: string; snippet?: string; score?: number }) => ({
        path: item.docid || item.path || '',
        content: item.content || item.snippet || '',
        score: item.score || 0,
        collection: collection
      }));
    } catch {
      return [];
    }
  } catch (error) {
    console.error('QMD search error:', error);
    return [];
  }
}

/**
 * Keyword-only search using QMD's BM25
 */
export function keywordSearch(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { collection = 'all', limit = 10 } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `qmd search "${escapedQuery}" ${collectionFlag} -n ${limit} --json`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 10000
    });

    try {
      const parsed = JSON.parse(result);
      return parsed.map((item: { docid?: string; path?: string; content?: string; snippet?: string; score?: number }) => ({
        path: item.docid || item.path || '',
        content: item.content || item.snippet || '',
        score: item.score || 0,
        collection: collection
      }));
    } catch {
      return [];
    }
  } catch (error) {
    console.error('QMD keyword search error:', error);
    return [];
  }
}

/**
 * Vector-only semantic search using QMD embeddings
 */
export function semanticSearch(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const { collection = 'all', limit = 10 } = options;

  try {
    const collectionFlag = collection === 'all' ? '' : `-c ${collection}`;
    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `qmd vsearch "${escapedQuery}" ${collectionFlag} -n ${limit} --json`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000
    });

    try {
      const parsed = JSON.parse(result);
      return parsed.map((item: { docid?: string; path?: string; content?: string; snippet?: string; score?: number }) => ({
        path: item.docid || item.path || '',
        content: item.content || item.snippet || '',
        score: item.score || 0,
        collection: collection
      }));
    } catch {
      return [];
    }
  } catch (error) {
    console.error('QMD semantic search error:', error);
    return [];
  }
}

/**
 * Build memory context string for AI prompts
 * Searches across all collections and formats results
 * Also tracks access to returned entities
 */
export async function buildMemoryContext(
  query: string,
  limit: number = 5
): Promise<string | null> {
  const results = searchMemory(query, { limit });

  if (results.length === 0) {
    return null;
  }

  // Track access to entities that were retrieved
  try {
    await recordSearchAccess(results.map(r => r.path));
  } catch (error) {
    console.error('Failed to record search access:', error);
  }

  const lines: string[] = [];

  for (const result of results) {
    // Extract filename from path for better readability
    const pathParts = result.path.split('/');
    const filename = pathParts[pathParts.length - 1] || result.path;
    const context = pathParts.slice(0, -1).join('/');

    lines.push(`**[${filename}]** (${context})`);
    lines.push(result.content.trim());
    lines.push('');
  }

  return lines.length > 0 ? lines.join('\n').trim() : null;
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
