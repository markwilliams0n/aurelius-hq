/**
 * Slack Connector
 *
 * Syncs Slack messages into triage inbox.
 */

export { syncSlackMessages } from './sync';
export {
  isConfigured,
  getChannels,
  getAuthInfo,
  getUserInfo,
  buildMessageUrl,
  searchMessages,
} from './client';
export {
  startSocketMode,
  stopSocketMode,
  getSocketStatus,
  isSocketConfigured,
} from './socket';
export type {
  SlackMessage,
  SlackChannel,
  SlackUser,
  SlackEnrichment,
  SlackSyncResult,
  SlackMessageType,
} from './types';
