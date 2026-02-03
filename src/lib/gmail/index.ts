/**
 * Gmail Connector
 *
 * Re-exports all Gmail functionality.
 */

export * from './types';
export * from './client';
export { syncGmailMessages } from './sync';
export {
  syncArchiveToGmail,
  syncSpamToGmail,
  replyToEmail,
  getUnsubscribeUrl,
} from './actions';
export type { GmailSyncResult } from './types';
