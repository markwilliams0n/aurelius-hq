import { NextRequest, NextResponse } from 'next/server';
import { searchMemory, keywordSearch, semanticSearch } from '@/lib/memory/search';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  const type = request.nextUrl.searchParams.get('type') || 'hybrid'; // hybrid, keyword, semantic
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

  // Enhance results with type information based on path
  const enhancedResults = results.map(r => {
    let entityType = 'unknown';
    if (r.path.includes('areas/people')) entityType = 'person';
    else if (r.path.includes('areas/companies')) entityType = 'company';
    else if (r.path.includes('projects')) entityType = 'project';
    else if (r.path.includes('resources')) entityType = 'resource';
    else if (r.path.includes('memory/')) entityType = 'daily-note';

    return {
      ...r,
      entityType,
    };
  });

  return NextResponse.json({
    query,
    type,
    collection,
    results: enhancedResults,
  });
}
