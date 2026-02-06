/**
 * Linear Connector Types
 */

// Notification types from Linear
export type LinearNotificationType =
  | 'issueAssignedToYou'
  | 'issueMention'
  | 'issueNewComment'
  | 'issueStatusChanged'
  | 'issuePriorityChanged'
  | 'issueSubscription'
  | 'projectUpdateMention'
  | 'issueCommentMention'
  | 'issueCommentReaction'
  | 'issueDue'
  | 'issueCreated';

// Actor who triggered the notification
export interface LinearActor {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

// Issue state
export interface LinearIssueState {
  id: string;
  name: string;
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
  color?: string;
  position?: number;
}

// Issue label
export interface LinearLabel {
  id: string;
  name: string;
  color?: string;
}

// Project
export interface LinearProject {
  id: string;
  name: string;
  state: string;
  url?: string;
  description?: string;
  color?: string;
  icon?: string;
}

// Comment
export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user?: LinearActor;
}

// Issue details
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  priority: number; // 0=none, 1=urgent, 2=high, 3=normal, 4=low
  state: LinearIssueState;
  team?: { id: string; name: string; key: string };
  project?: LinearProject;
  labels: { nodes: LinearLabel[] };
  assignee?: LinearActor;
  creator?: LinearActor;
  createdAt: string;
  updatedAt: string;
}

// Project update
export interface LinearProjectUpdate {
  id: string;
  body: string;
  url?: string;
  createdAt: string;
  user?: LinearActor;
}

// Initiative
export interface LinearInitiative {
  id: string;
  name: string;
  description?: string;
  status?: string;
}

// Initiative update
export interface LinearInitiativeUpdate {
  body: string;
}

// Notification from Linear API
export interface LinearNotification {
  id: string;
  type: string;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
  actor?: LinearActor;
  // IssueNotification fields
  issue?: LinearIssue;
  comment?: LinearComment;
  // ProjectNotification fields
  project?: LinearProject;
  projectUpdate?: LinearProjectUpdate;
  // InitiativeNotification fields
  initiative?: LinearInitiative;
  initiativeUpdate?: LinearInitiativeUpdate;
}

// Paginated response
export interface LinearNotificationsResponse {
  notifications: {
    nodes: LinearNotification[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string;
    };
  };
}

// Enrichment stored in inbox_items
export interface LinearEnrichment {
  // Notification context
  notificationType: string;

  // Issue details
  issueId: string;
  issueIdentifier: string;
  issueState: string;
  issueStateType: string;
  issuePriority: number;
  issueProject?: string;
  issueLabels: string[];

  // Actor who triggered
  actor?: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  };

  // Links
  linearUrl: string;

  // Standard enrichment fields
  summary?: string;
  linkedEntities?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

// Sync result
export interface LinearSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  error?: string;
}

// Sync state persisted in configs
export interface LinearSyncState {
  lastSyncAt?: string;
  lastNotificationId?: string;
}
