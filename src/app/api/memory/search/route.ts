import { NextRequest, NextResponse } from 'next/server';
import { searchMemory, keywordSearch, semanticSearch } from '@/lib/memory/search';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  // Default to keyword search (fast ~0.3s) instead of hybrid (slow ~8s)
  const type = request.nextUrl.searchParams.get('type') || 'keyword';
  const collection = request.nextUrl.searchParams.get('collection') as 'life' | 'memory' | 'me' | 'all' || 'all';
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  let results;
  switch (type) {
    case 'keyword':
      results = keywordSearch(query, { collection, limit });
      break;
    case 'semantic':
      results = semanticSearch(query, { collection, limit });
      break;
    case 'hybrid':
    default:
      results = searchMemory(query, { collection, limit });
  }

  // Enhance results with type information and friendly names based on path
  const enhancedResults = results.map(r => {
    let entityType = 'unknown';
    let entityName = '';
    let category = '';

    // Determine type and extract name from path
    if (r.path.includes('areas/people/')) {
      entityType = 'person';
      // Extract: life/areas/people/john-smith/summary.md -> john-smith
      const match = r.path.match(/areas\/people\/([^/]+)/);
      entityName = match ? formatName(match[1]) : '';
      category = 'People';
    } else if (r.path.includes('areas/companies/')) {
      entityType = 'company';
      const match = r.path.match(/areas\/companies\/([^/]+)/);
      entityName = match ? formatName(match[1]) : '';
      category = 'Companies';
    } else if (r.path.includes('projects/')) {
      entityType = 'project';
      const match = r.path.match(/projects\/([^/]+)/);
      entityName = match ? formatName(match[1]) : '';
      category = 'Projects';
    } else if (r.path.includes('resources/')) {
      entityType = 'resource';
      const match = r.path.match(/resources\/([^/]+)/);
      entityName = match ? formatName(match[1]) : '';
      category = 'Resources';
    } else if (r.path.includes('memory/')) {
      entityType = 'daily-note';
      // Extract date from: memory/2026-02-02.md
      const match = r.path.match(/memory\/(\d{4}-\d{2}-\d{2})/);
      entityName = match ? formatDate(match[1]) : 'Daily Note';
      category = 'Daily Notes';
    }

    // If no name extracted, try to get from filename
    if (!entityName) {
      const filename = r.path.split('/').pop()?.replace('.md', '').replace('.json', '') || '';
      entityName = formatName(filename);
    }

    return {
      ...r,
      content: cleanContent(r.content),
      entityType,
      entityName,
      category,
    };
  });

  // Helper to format kebab-case to Title Case
  function formatName(slug: string): string {
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // Helper to format date
  function formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  // Helper to clean content snippets
  function cleanContent(content: string): string {
    if (!content) return '';

    return content
      // Remove markdown headers
      .replace(/^#+\s*/gm, '')
      // Remove **Type:** patterns and similar metadata
      .replace(/\*\*Type:\*\*\s*\w+/gi, '')
      .replace(/\*\*Status:\*\*\s*\w+/gi, '')
      // Remove bold markers around single words that look like metadata
      .replace(/\*\*(\w+):\*\*/g, '')
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  return NextResponse.json({
    query,
    type,
    collection,
    results: enhancedResults,
  });
}
