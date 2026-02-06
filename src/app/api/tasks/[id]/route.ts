import { NextResponse } from 'next/server';
import { updateIssue } from '@/lib/linear/issues';

export const runtime = 'nodejs';

/**
 * PATCH /api/tasks/[id]
 *
 * Update a Linear issue (status, assignee, project, priority).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { stateId, assigneeId, projectId, priority, title, description } = body as {
      stateId?: string;
      assigneeId?: string | null;
      projectId?: string | null;
      priority?: number;
      title?: string;
      description?: string;
    };

    const result = await updateIssue(id, {
      stateId,
      assigneeId,
      projectId,
      priority,
      title,
      description,
    });

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
    }

    return NextResponse.json({ success: true, issue: result.issue });
  } catch (error) {
    console.error('[Tasks API] Failed to update task:', error);
    return NextResponse.json(
      { error: 'Failed to update task', details: String(error) },
      { status: 500 }
    );
  }
}
