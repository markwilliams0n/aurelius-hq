import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/linear/client';
import { createIssue } from '@/lib/linear/issues';

export const runtime = 'nodejs';

/**
 * POST /api/tasks/create
 *
 * Create a new Linear issue.
 */
export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Linear not configured' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { title, description, teamId, stateId, assigneeId, projectId, priority } = body as {
      title: string;
      description?: string;
      teamId: string;
      stateId?: string;
      assigneeId?: string;
      projectId?: string;
      priority?: number;
    };

    if (!title || !teamId) {
      return NextResponse.json(
        { error: 'title and teamId are required' },
        { status: 400 }
      );
    }

    const result = await createIssue({
      title,
      description,
      teamId,
      stateId,
      assigneeId,
      projectId,
      priority,
    });

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to create issue' }, { status: 500 });
    }

    return NextResponse.json({ success: true, issue: result.issue });
  } catch (error) {
    console.error('[Tasks API] Failed to create task:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
