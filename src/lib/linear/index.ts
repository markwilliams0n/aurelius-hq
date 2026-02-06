/**
 * Linear Connector
 *
 * Syncs Linear notifications into triage inbox.
 * Fetches issues for task management.
 */

export { syncLinearNotifications } from './sync';
export {
  isConfigured,
  archiveNotification,
  getCurrentUser,
  priorityLabel,
  notificationDescription,
} from './client';
export {
  fetchMyIssues,
  fetchProjectIssues,
  fetchViewerContext,
  fetchAllMyTasks,
  fetchWorkflowStates,
  fetchTeamMembers,
  updateIssue,
  createIssue,
} from './issues';
export type {
  LinearNotification,
  LinearEnrichment,
  LinearSyncResult,
  LinearIssue,
  LinearActor,
} from './types';
export type { LinearIssueWithMeta } from './issues';
