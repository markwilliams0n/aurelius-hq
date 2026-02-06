/**
 * Linear Issues API
 *
 * Fetches issues from Linear for the tasks page.
 * Queries: assigned to viewer, personal project issues.
 */

import type { LinearIssue } from './types';
import { graphql } from './client';

/**
 * Get the Linear user ID of the task owner.
 * When the API key belongs to an agent account (e.g. "Mark's Agent"),
 * LINEAR_OWNER_USER_ID identifies the human owner whose tasks we manage.
 * Falls back to "isMe" (the API key holder) if not set.
 */
function getOwnerFilter(): Record<string, unknown> {
  const ownerUserId = process.env.LINEAR_OWNER_USER_ID;
  if (ownerUserId) {
    return { assignee: { id: { eq: ownerUserId } } };
  }
  return { assignee: { isMe: { eq: true } } };
}

/**
 * Get the owner's Linear user ID, if configured.
 * Used by task tools to auto-assign to the human owner.
 */
export function getOwnerUserId(): string | undefined {
  return process.env.LINEAR_OWNER_USER_ID || undefined;
}

const ISSUE_FRAGMENT = `
  id
  identifier
  title
  description
  url
  priority
  sortOrder
  createdAt
  updatedAt
  dueDate
  state {
    id
    name
    type
    color
    position
  }
  project {
    id
    name
    state
    color
    icon
  }
  labels {
    nodes {
      id
      name
      color
    }
  }
  team {
    id
    name
    key
  }
  assignee {
    id
    name
    email
    avatarUrl
  }
  creator {
    id
    name
    email
    avatarUrl
  }
`;

export interface LinearIssueWithMeta extends LinearIssue {
  dueDate?: string;
}

interface IssuesResponse {
  nodes: LinearIssueWithMeta[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor?: string;
  };
}

/**
 * Fetch issues assigned to the current user (viewer)
 * Returns active issues (not completed/canceled) by default
 */
export async function fetchMyIssues(opts?: {
  includeCompleted?: boolean;
  cursor?: string;
}): Promise<{ issues: LinearIssueWithMeta[]; hasMore: boolean; endCursor?: string }> {
  const filter: Record<string, unknown> = {
    ...getOwnerFilter(),
  };

  if (!opts?.includeCompleted) {
    filter.state = {
      type: { nin: ['completed', 'canceled'] },
    };
  }

  const query = `
    query MyIssues($filter: IssueFilter, $after: String) {
      issues(
        first: 100
        after: $after
        filter: $filter
        orderBy: updatedAt
      ) {
        nodes {
          ${ISSUE_FRAGMENT}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await graphql<{ issues: IssuesResponse }>(query, {
    filter,
    after: opts?.cursor,
  });

  return {
    issues: data.issues.nodes,
    hasMore: data.issues.pageInfo.hasNextPage,
    endCursor: data.issues.pageInfo.endCursor ?? undefined,
  };
}

/**
 * Fetch issues from a specific project
 */
export async function fetchProjectIssues(
  projectId: string,
  opts?: {
    includeCompleted?: boolean;
    cursor?: string;
  }
): Promise<{ issues: LinearIssueWithMeta[]; hasMore: boolean; endCursor?: string }> {
  const filter: Record<string, unknown> = {
    project: { id: { eq: projectId } },
  };

  if (!opts?.includeCompleted) {
    filter.state = {
      type: { nin: ['completed', 'canceled'] },
    };
  }

  const query = `
    query ProjectIssues($filter: IssueFilter, $after: String) {
      issues(
        first: 100
        after: $after
        filter: $filter
        orderBy: updatedAt
      ) {
        nodes {
          ${ISSUE_FRAGMENT}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await graphql<{ issues: IssuesResponse }>(query, {
    filter,
    after: opts?.cursor,
  });

  return {
    issues: data.issues.nodes,
    hasMore: data.issues.pageInfo.hasNextPage,
    endCursor: data.issues.pageInfo.endCursor ?? undefined,
  };
}

/**
 * Fetch accessible teams, projects, and viewer info.
 * Uses the top-level `teams` query (not teamMemberships) so the agent
 * sees all teams it has access to, not just teams it's a member of.
 */
export async function fetchViewerContext(): Promise<{
  viewer: {
    id: string;
    name: string;
    email: string;
  };
  teams: Array<{
    id: string;
    name: string;
    key: string;
  }>;
  projects: Array<{
    id: string;
    name: string;
    state: string;
    color?: string;
    icon?: string;
  }>;
}> {
  const query = `
    query ViewerContext {
      viewer {
        id
        name
        email
      }
      teams {
        nodes {
          id
          name
          key
          projects {
            nodes {
              id
              name
              state
              color
              icon
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    viewer: {
      id: string;
      name: string;
      email: string;
    };
    teams: {
      nodes: Array<{
        id: string;
        name: string;
        key: string;
        projects: {
          nodes: Array<{
            id: string;
            name: string;
            state: string;
            color?: string;
            icon?: string;
          }>;
        };
      }>;
    };
  }>(query);

  const teams = data.teams.nodes.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.key,
  }));

  // Deduplicate projects across teams
  const projectMap = new Map<string, { id: string; name: string; state: string; color?: string; icon?: string }>();
  for (const t of data.teams.nodes) {
    for (const p of t.projects.nodes) {
      if (!projectMap.has(p.id)) {
        projectMap.set(p.id, p);
      }
    }
  }
  const projects = Array.from(projectMap.values());

  return {
    viewer: {
      id: data.viewer.id,
      name: data.viewer.name,
      email: data.viewer.email,
    },
    teams,
    projects,
  };
}

/**
 * Fetch workflow states for all accessible teams
 */
export async function fetchWorkflowStates(): Promise<
  Array<{
    id: string;
    name: string;
    type: string;
    color: string;
    position: number;
    team: { id: string; name: string };
  }>
> {
  const query = `
    query WorkflowStates {
      teams {
        nodes {
          id
          name
          states {
            nodes {
              id
              name
              type
              color
              position
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    teams: {
      nodes: Array<{
        id: string;
        name: string;
        states: {
          nodes: Array<{
            id: string;
            name: string;
            type: string;
            color: string;
            position: number;
          }>;
        };
      }>;
    };
  }>(query);

  const stateMap = new Map<string, {
    id: string;
    name: string;
    type: string;
    color: string;
    position: number;
    team: { id: string; name: string };
  }>();

  for (const t of data.teams.nodes) {
    for (const s of t.states.nodes) {
      if (!stateMap.has(s.id)) {
        stateMap.set(s.id, {
          ...s,
          team: { id: t.id, name: t.name },
        });
      }
    }
  }

  return Array.from(stateMap.values()).sort((a, b) => a.position - b.position);
}

/**
 * Fetch team members across all accessible teams
 */
export async function fetchTeamMembers(): Promise<
  Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  }>
> {
  const query = `
    query TeamMembers {
      teams {
        nodes {
          members {
            nodes {
              id
              name
              email
              avatarUrl
              active
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    teams: {
      nodes: Array<{
        members: {
          nodes: Array<{
            id: string;
            name: string;
            email: string;
            avatarUrl?: string;
            active: boolean;
          }>;
        };
      }>;
    };
  }>(query);

  const memberMap = new Map<string, {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  }>();

  for (const t of data.teams.nodes) {
    for (const member of t.members.nodes) {
      if (member.active && !memberMap.has(member.id)) {
        memberMap.set(member.id, {
          id: member.id,
          name: member.name,
          email: member.email,
          avatarUrl: member.avatarUrl,
        });
      }
    }
  }

  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Update a Linear issue
 */
export async function updateIssue(
  issueId: string,
  updates: {
    stateId?: string;
    assigneeId?: string | null;
    projectId?: string | null;
    priority?: number;
    title?: string;
    description?: string;
  }
): Promise<{ success: boolean; issue?: LinearIssueWithMeta }> {
  const mutation = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          ${ISSUE_FRAGMENT}
        }
      }
    }
  `;

  const input: Record<string, unknown> = {};
  if (updates.stateId !== undefined) input.stateId = updates.stateId;
  if (updates.assigneeId !== undefined) input.assigneeId = updates.assigneeId;
  if (updates.projectId !== undefined) input.projectId = updates.projectId;
  if (updates.priority !== undefined) input.priority = updates.priority;
  if (updates.title !== undefined) input.title = updates.title;
  if (updates.description !== undefined) input.description = updates.description;

  const data = await graphql<{
    issueUpdate: {
      success: boolean;
      issue: LinearIssueWithMeta;
    };
  }>(mutation, { id: issueId, input });

  return {
    success: data.issueUpdate.success,
    issue: data.issueUpdate.issue,
  };
}

/**
 * Create a new Linear issue
 */
export async function createIssue(input: {
  title: string;
  description?: string;
  teamId: string;
  stateId?: string;
  assigneeId?: string;
  projectId?: string;
  priority?: number;
}): Promise<{ success: boolean; issue?: LinearIssueWithMeta }> {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          ${ISSUE_FRAGMENT}
        }
      }
    }
  `;

  const data = await graphql<{
    issueCreate: {
      success: boolean;
      issue: LinearIssueWithMeta;
    };
  }>(mutation, { input });

  return {
    success: data.issueCreate.success,
    issue: data.issueCreate.issue,
  };
}

/**
 * Fetch a single issue by ID (UUID) or identifier (e.g. "PER-123")
 */
export async function fetchIssue(idOrIdentifier: string): Promise<LinearIssueWithMeta | null> {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(idOrIdentifier);

  if (isUUID) {
    try {
      const query = `
        query GetIssue($id: String!) {
          issue(id: $id) {
            ${ISSUE_FRAGMENT}
          }
        }
      `;
      const data = await graphql<{ issue: LinearIssueWithMeta }>(query, { id: idOrIdentifier });
      return data.issue;
    } catch {
      return null;
    }
  }

  // Parse identifier (e.g. "PER-153") into team key + issue number
  const identifierMatch = idOrIdentifier.toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if (!identifierMatch) {
    return null;
  }

  const [, teamKey, numberStr] = identifierMatch;
  const issueNumber = parseInt(numberStr, 10);

  try {
    const query = `
      query SearchIssue($filter: IssueFilter) {
        issues(first: 1, filter: $filter) {
          nodes {
            ${ISSUE_FRAGMENT}
          }
        }
      }
    `;
    const data = await graphql<{ issues: { nodes: LinearIssueWithMeta[] } }>(query, {
      filter: {
        team: { key: { eq: teamKey } },
        number: { eq: issueNumber },
      },
    });
    return data.issues.nodes[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch all issues: assigned to me + specific project(s)
 * Deduplicates issues that appear in both sets
 */
export async function fetchAllMyTasks(projectIds?: string[]): Promise<{
  issues: LinearIssueWithMeta[];
  context: Awaited<ReturnType<typeof fetchViewerContext>>;
}> {
  // Fetch viewer context and first page of my issues in parallel
  const [context, firstPage] = await Promise.all([
    fetchViewerContext(),
    fetchMyIssues(),
  ]);

  const allIssues = new Map<string, LinearIssueWithMeta>();

  // Add first page of assigned issues
  for (const issue of firstPage.issues) {
    allIssues.set(issue.id, issue);
  }

  // Paginate through remaining assigned issues
  let hasMore = firstPage.hasMore;
  let cursor = firstPage.endCursor;
  while (hasMore && cursor) {
    const page = await fetchMyIssues({ cursor });
    for (const issue of page.issues) {
      allIssues.set(issue.id, issue);
    }
    hasMore = page.hasMore;
    cursor = page.endCursor;
  }

  // Fetch project issues if project IDs provided
  if (projectIds && projectIds.length > 0) {
    const projectResults = await Promise.all(
      projectIds.map((pid) => fetchProjectIssues(pid))
    );

    for (const result of projectResults) {
      for (const issue of result.issues) {
        if (!allIssues.has(issue.id)) {
          allIssues.set(issue.id, issue);
        }
      }
    }
  }

  return {
    issues: Array.from(allIssues.values()),
    context,
  };
}
