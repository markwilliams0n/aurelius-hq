/**
 * Gmail Connector
 *
 * Re-exports all Gmail functionality.
 */

export * from './types';
export * from './client';
export { syncGmailMessages } from './sync';
export type { GmailSyncResult } from './types';
