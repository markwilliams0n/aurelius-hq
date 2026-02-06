import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/linear/client';
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
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Linear not configured' }, { status: 400 });
  }

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

    console.log(`[Tasks API] Updating task ${id}:`, { stateId, assigneeId, projectId, priority });

    const result = await updateIssue(id, {
      stateId,
      assigneeId,
      projectId,
      priority,
      title,
      description,
    });

    if (!result.success) {
      console.error(`[Tasks API] Linear returned success=false for task ${id}`);
      return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
    }

    console.log(`[Tasks API] Successfully updated task ${id}`);
    return NextResponse.json({ success: true, issue: result.issue });
  } catch (error) {
    console.error('[Tasks API] Failed to update task:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}
