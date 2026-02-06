/**
 * Linear Issues API
 *
 * Fetches issues from Linear for the tasks page.
 * Queries: assigned to viewer, personal project issues.
 */

import type { LinearIssue } from './types';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Execute a GraphQL query against Linear API
 */
async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    throw new Error('LINEAR_API_KEY not configured');
  }

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API error: ${response.status} ${text}`);
  }

  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }

  return json.data;
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
    assignee: { isMe: { eq: true } },
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
 * Fetch the current viewer's teams and projects (for filtering)
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
        teamMemberships {
          nodes {
            team {
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
      }
    }
  `;

  const data = await graphql<{
    viewer: {
      id: string;
      name: string;
      email: string;
      teamMemberships: {
        nodes: Array<{
          team: {
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
          };
        }>;
      };
    };
  }>(query);

  const teams = data.viewer.teamMemberships.nodes.map((m) => ({
    id: m.team.id,
    name: m.team.name,
    key: m.team.key,
  }));

  // Deduplicate projects that appear across multiple teams
  const projectMap = new Map<string, typeof data.viewer.teamMemberships.nodes[0]['team']['projects']['nodes'][0]>();
  for (const m of data.viewer.teamMemberships.nodes) {
    for (const p of m.team.projects.nodes) {
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
 * Fetch workflow states for all teams the viewer belongs to
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
      viewer {
        teamMemberships {
          nodes {
            team {
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
      }
    }
  `;

  const data = await graphql<{
    viewer: {
      teamMemberships: {
        nodes: Array<{
          team: {
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
          };
        }>;
      };
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

  for (const m of data.viewer.teamMemberships.nodes) {
    for (const s of m.team.states.nodes) {
      if (!stateMap.has(s.id)) {
        stateMap.set(s.id, {
          ...s,
          team: { id: m.team.id, name: m.team.name },
        });
      }
    }
  }

  return Array.from(stateMap.values()).sort((a, b) => a.position - b.position);
}

/**
 * Fetch team members for all teams the viewer belongs to
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
      viewer {
        teamMemberships {
          nodes {
            team {
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
      }
    }
  `;

  const data = await graphql<{
    viewer: {
      teamMemberships: {
        nodes: Array<{
          team: {
            members: {
              nodes: Array<{
                id: string;
                name: string;
                email: string;
                avatarUrl?: string;
                active: boolean;
              }>;
            };
          };
        }>;
      };
    };
  }>(query);

  const memberMap = new Map<string, {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  }>();

  for (const m of data.viewer.teamMemberships.nodes) {
    for (const member of m.team.members.nodes) {
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
 * Fetch all issues: assigned to me + specific project(s)
 * Deduplicates issues that appear in both sets
 */
export async function fetchAllMyTasks(projectIds?: string[]): Promise<{
  issues: LinearIssueWithMeta[];
  context: Awaited<ReturnType<typeof fetchViewerContext>>;
}> {
  // Fetch viewer context and my issues in parallel
  const [context, myIssuesResult] = await Promise.all([
    fetchViewerContext(),
    fetchMyIssues(),
  ]);

  const allIssues = new Map<string, LinearIssueWithMeta>();

  // Add my assigned issues
  for (const issue of myIssuesResult.issues) {
    allIssues.set(issue.id, issue);
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
