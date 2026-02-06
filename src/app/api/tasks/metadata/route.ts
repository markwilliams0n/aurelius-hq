import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/linear/client';
import { fetchWorkflowStates, fetchTeamMembers, fetchViewerContext } from '@/lib/linear/issues';

export const runtime = 'nodejs';

/**
 * GET /api/tasks/metadata
 *
 * Fetch workflow states, team members, projects — everything needed
 * for action menus (status change, assign, move to project).
 */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Linear not configured' }, { status: 400 });
  }

  try {
    const [states, members, context] = await Promise.all([
      fetchWorkflowStates(),
      fetchTeamMembers(),
      fetchViewerContext(),
    ]);

    return NextResponse.json({
      states,
      members,
      teams: context.teams,
      projects: context.projects,
      viewer: context.viewer,
    });
  } catch (error) {
    console.error('[Tasks API] Failed to fetch metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metadata', details: String(error) },
      { status: 500 }
    );
  }
}
