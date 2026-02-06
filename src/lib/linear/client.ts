/**
 * Linear API Client
 *
 * Supports two auth modes:
 * 1. OAuth client credentials (LINEAR_CLIENT_ID + LINEAR_CLIENT_SECRET)
 *    → Acts as "Aurelius" agent in Linear, auto-refreshes 30-day tokens
 * 2. Personal API key (LINEAR_API_KEY) — fallback for backwards compat
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  LinearNotification,
  LinearNotificationsResponse,
  LinearSyncState,
} from './types';

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const SYNC_STATE_PATH = path.join(process.cwd(), '.linear-sync-state.json');

// In-memory OAuth token cache
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Check if Linear connector is configured
 */
export function isConfigured(): boolean {
  return !!(
    (process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET) ||
    process.env.LINEAR_API_KEY
  );
}

/**
 * Get an OAuth access token using client credentials grant.
 * Caches the token in memory and refreshes when expired or on 401.
 */
async function getOAuthToken(forceRefresh = false): Promise<string> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET not configured');
  }

  // Return cached token if still valid (with 5 min buffer)
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.accessToken;
  }

  console.log('[Linear] Requesting new OAuth token via client credentials...');

  // Use HTTP Basic auth as recommended by Linear docs
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'read,write',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    // Provide helpful error for common setup issue
    if (text.includes('client_credentials')) {
      throw new Error(
        'Linear OAuth app does not have client credentials enabled. ' +
        'Go to Linear Settings > API > OAuth Applications, edit the app, ' +
        'and toggle on "Client credentials". ' +
        `Original error: ${text}`
      );
    }
    throw new Error(`Linear OAuth token error: ${response.status} ${text}`);
  }

  const data = await response.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  console.log('[Linear] OAuth token obtained, expires in', Math.round(data.expires_in / 86400), 'days');
  return cachedToken.accessToken;
}

/**
 * Get the authorization header value.
 * Uses OAuth if client credentials are configured, otherwise falls back to API key.
 */
async function getAuthHeader(forceRefresh = false): Promise<string> {
  if (process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET) {
    const token = await getOAuthToken(forceRefresh);
    return `Bearer ${token}`;
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error('No Linear credentials configured. Set LINEAR_CLIENT_ID + LINEAR_CLIENT_SECRET, or LINEAR_API_KEY.');
  }
  return apiKey;
}

/**
 * Execute a GraphQL query against Linear API
 */
export async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const auth = await getAuthHeader();

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify({ query, variables }),
  });

  // On 401, try refreshing the OAuth token and retry once
  if (response.status === 401 && process.env.LINEAR_CLIENT_ID) {
    console.log('[Linear] Got 401, refreshing OAuth token...');
    const freshAuth = await getAuthHeader(true);
    const retryResponse = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: freshAuth,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!retryResponse.ok) {
      const text = await retryResponse.text();
      throw new Error(`Linear API error: ${retryResponse.status} ${text}`);
    }

    const retryJson = await retryResponse.json();
    if (retryJson.errors?.length > 0) {
      throw new Error(`Linear GraphQL error: ${retryJson.errors[0].message}`);
    }
    return retryJson.data;
  }

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
 * Uses inline fragments for IssueNotification since Notification is a union type
 */
export async function fetchNotifications(
  cursor?: string
): Promise<{ notifications: LinearNotification[]; hasMore: boolean; endCursor?: string }> {
  const query = `
    query Notifications($after: String) {
      notifications(first: 50, after: $after) {
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
          ... on IssueNotification {
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
          ... on ProjectNotification {
            project {
              id
              name
              url
              state
              description
            }
            projectUpdate {
              id
              body
              url
              createdAt
              user {
                id
                name
                email
                avatarUrl
              }
            }
          }
          ... on InitiativeNotification {
            initiative {
              id
              name
              description
              status
            }
            initiativeUpdate {
              body
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

  // Filter to only unread notifications (readAt is null)
  const unreadNotifications = data.notifications.nodes.filter(
    (n) => !n.readAt && !n.archivedAt
  );

  return {
    notifications: unreadNotifications,
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
 * Get sync state from file
 */
export async function getSyncState(): Promise<LinearSyncState> {
  try {
    const content = await fs.readFile(SYNC_STATE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save sync state to file
 */
export async function saveSyncState(state: LinearSyncState): Promise<void> {
  await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
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
