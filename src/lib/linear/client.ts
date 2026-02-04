/**
 * Linear API Client
 *
 * GraphQL client for Linear API with API key auth.
 */

import { db } from '@/lib/db';
import { configs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type {
  LinearNotification,
  LinearNotificationsResponse,
  LinearSyncState,
} from './types';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Check if Linear connector is configured
 */
export function isConfigured(): boolean {
  return !!process.env.LINEAR_API_KEY;
}

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

/**
 * Fetch unread/unarchived notifications
 */
export async function fetchNotifications(
  cursor?: string
): Promise<{ notifications: LinearNotification[]; hasMore: boolean; endCursor?: string }> {
  const query = `
    query Notifications($after: String) {
      notifications(
        first: 50
        after: $after
        filter: { readAt: { null: true } }
      ) {
        nodes {
          id
          type
          createdAt
          readAt
          archivedAt
          actor {
            id
            name
            email
            avatarUrl
          }
          issue {
            id
            identifier
            title
            description
            url
            priority
            createdAt
            updatedAt
            state {
              id
              name
              type
            }
            project {
              id
              name
              state
            }
            labels {
              nodes {
                id
                name
                color
              }
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
          }
          comment {
            id
            body
            createdAt
            user {
              id
              name
              email
              avatarUrl
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await graphql<LinearNotificationsResponse>(query, {
    after: cursor,
  });

  return {
    notifications: data.notifications.nodes,
    hasMore: data.notifications.pageInfo.hasNextPage,
    endCursor: data.notifications.pageInfo.endCursor ?? undefined,
  };
}

/**
 * Archive (mark as read) a notification
 */
export async function archiveNotification(notificationId: string): Promise<boolean> {
  const query = `
    mutation ArchiveNotification($id: String!) {
      notificationArchive(id: $id) {
        success
      }
    }
  `;

  const data = await graphql<{ notificationArchive: { success: boolean } }>(query, {
    id: notificationId,
  });

  return data.notificationArchive.success;
}

/**
 * Get current user info (for verification)
 */
export async function getCurrentUser(): Promise<{
  id: string;
  name: string;
  email: string;
}> {
  const query = `
    query Viewer {
      viewer {
        id
        name
        email
      }
    }
  `;

  const data = await graphql<{ viewer: { id: string; name: string; email: string } }>(query);
  return data.viewer;
}

/**
 * Get sync state from database
 */
export async function getSyncState(): Promise<LinearSyncState> {
  const result = await db
    .select()
    .from(configs)
    .where(eq(configs.key, 'connector:linear:sync'))
    .limit(1);

  if (result.length === 0) {
    return {};
  }

  try {
    return JSON.parse(result[0].content) as LinearSyncState;
  } catch {
    return {};
  }
}

/**
 * Save sync state to database
 */
export async function saveSyncState(state: LinearSyncState): Promise<void> {
  const content = JSON.stringify(state);

  const existing = await db
    .select()
    .from(configs)
    .where(eq(configs.key, 'connector:linear:sync'))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(configs).values({
      key: 'connector:linear:sync',
      content,
      version: 1,
      createdBy: 'system',
    });
  } else {
    await db
      .update(configs)
      .set({
        content,
        version: existing[0].version + 1,
        updatedAt: new Date(),
      })
      .where(eq(configs.key, 'connector:linear:sync'));
  }
}

/**
 * Map Linear priority number to readable string
 */
export function priorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return 'No priority';
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Normal';
    case 4:
      return 'Low';
    default:
      return 'Unknown';
  }
}

/**
 * Map notification type to readable description
 */
export function notificationDescription(type: string, actor?: { name: string }): string {
  const actorName = actor?.name ?? 'Someone';

  switch (type) {
    case 'issueAssignedToYou':
      return `${actorName} assigned you`;
    case 'issueMention':
    case 'issueCommentMention':
      return `${actorName} mentioned you`;
    case 'issueNewComment':
      return `${actorName} commented`;
    case 'issueStatusChanged':
      return `${actorName} changed status`;
    case 'issuePriorityChanged':
      return `${actorName} changed priority`;
    case 'issueSubscription':
      return 'Issue updated';
    case 'projectUpdateMention':
      return `${actorName} mentioned you in project update`;
    case 'issueDue':
      return 'Issue due soon';
    case 'issueCreated':
      return `${actorName} created issue`;
    default:
      return `${actorName} updated`;
  }
}
