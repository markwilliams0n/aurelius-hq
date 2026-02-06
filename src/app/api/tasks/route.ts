import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/linear/client';
import { fetchAllMyTasks } from '@/lib/linear/issues';
import { db } from '@/lib/db';
import { suggestedTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * GET /api/tasks
 *
 * Fetches all tasks: Linear issues (assigned to me + personal project) + accepted triage tasks.
 * Query params:
 *   - projectIds: comma-separated Linear project IDs to include
 *   - includeTriageTasks: include accepted suggested tasks from triage (default: true)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectIdsParam = url.searchParams.get('projectIds');
  const includeTriageTasks = url.searchParams.get('includeTriageTasks') !== 'false';

  const projectIds = projectIdsParam ? projectIdsParam.split(',').filter(Boolean) : undefined;

  try {
    // Fetch Linear issues and triage tasks in parallel
    const [linearResult, triageTasks] = await Promise.all([
      isConfigured()
        ? fetchAllMyTasks(projectIds)
        : Promise.resolve({ issues: [], context: null }),
      includeTriageTasks
        ? db.select().from(suggestedTasks).where(eq(suggestedTasks.status, 'accepted'))
        : Promise.resolve([]),
    ]);

    // Map Linear issues to unified task format
    const linearTasks = linearResult.issues.map((issue) => ({
      id: issue.id,
      source: 'linear' as const,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
      url: issue.url,
      priority: issue.priority,
      dueDate: issue.dueDate ?? null,
      state: {
        name: issue.state.name,
        type: issue.state.type,
        color: issue.state.color,
      },
      project: issue.project
        ? {
            id: issue.project.id,
            name: issue.project.name,
            color: issue.project.color,
            icon: issue.project.icon,
          }
        : null,
      labels: issue.labels.nodes.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      assignee: issue.assignee
        ? {
            id: issue.assignee.id,
            name: issue.assignee.name,
            avatarUrl: issue.assignee.avatarUrl,
          }
        : null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));

    // Map triage tasks to unified format
    const triageTaskItems = (triageTasks as typeof triageTasks).map((task) => ({
      id: task.id,
      source: 'triage' as const,
      identifier: null,
      title: task.description,
      description: null,
      url: null,
      priority: task.assigneeType === 'self' ? 3 : 4, // normal / low
      dueDate: task.dueDate,
      state: {
        name: 'Triage',
        type: 'triage' as const,
        color: '#9333ea', // purple
      },
      project: null,
      labels: [] as Array<{ id: string; name: string; color?: string }>,
      assignee: task.assignee
        ? { id: 'triage', name: task.assignee, avatarUrl: undefined }
        : null,
      createdAt: task.extractedAt.toISOString(),
      updatedAt: task.extractedAt.toISOString(),
    }));

    return NextResponse.json({
      tasks: [...linearTasks, ...triageTaskItems],
      context: linearResult.context,
      counts: {
        linear: linearTasks.length,
        triage: triageTaskItems.length,
        total: linearTasks.length + triageTaskItems.length,
      },
    });
  } catch (error) {
    console.error('[Tasks API] Failed to fetch tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks', details: String(error) },
      { status: 500 }
    );
  }
}
