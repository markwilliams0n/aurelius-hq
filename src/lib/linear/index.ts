/**
 * Linear Connector
 *
 * Syncs Linear notifications into triage inbox.
 */

export { syncLinearNotifications } from './sync';
export {
  isConfigured,
  archiveNotification,
  getCurrentUser,
  priorityLabel,
  notificationDescription,
} from './client';
export type {
  LinearNotification,
  LinearEnrichment,
  LinearSyncResult,
  LinearIssue,
  LinearActor,
} from './types';
