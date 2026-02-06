import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listMemories, getProfile } from '@/lib/memory/supermemory';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
      const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));
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
