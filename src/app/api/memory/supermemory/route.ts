import { NextRequest, NextResponse } from 'next/server';
import { listMemories, getProfile } from '@/lib/memory/supermemory';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'overview';

  try {
    if (view === 'overview') {
      const [memoriesPage, profile] = await Promise.all([
        listMemories({ page: 1, limit: 1 }),
        getProfile(),
      ]);

      return NextResponse.json({
        stats: {
          totalMemories: memoriesPage.pagination.totalItems,
          totalPages: memoriesPage.pagination.totalPages,
        },
        profile: profile.profile,
      });
    }

    if (view === 'memories') {
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '20');
      const result = await listMemories({ page, limit });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
  } catch (error) {
    console.error('Supermemory API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Supermemory' },
      { status: 500 }
    );
  }
}
