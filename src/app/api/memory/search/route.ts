import { NextRequest, NextResponse } from 'next/server';
import { searchMemories } from '@/lib/memory/supermemory';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchMemories(query, limit);

    return NextResponse.json({
      query,
      results,
    });
  } catch (error) {
    console.error('Memory search error:', error);
    return NextResponse.json({
      query,
      results: [],
      error: 'Search failed',
    });
  }
}
