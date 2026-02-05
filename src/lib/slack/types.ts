/**
 * Slack Connector Types
 */

// Slack user info
export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_48?: string;
    image_72?: string;
  };
}

// Slack channel info
export interface SlackChannel {
  id: string;
  name: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  last_read?: string; // Timestamp of last read message
}

// Slack message
export interface SlackMessage {
  type: string;
  ts: string; // Timestamp - unique ID for messages
  user?: string; // User ID who sent it
  text: string;
  thread_ts?: string; // If this is a thread reply
  reply_count?: number;
  reactions?: Array<{
    name: string;
    count: number;
    users: string[];
  }>;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private?: string;
  }>;
  attachments?: Array<{
    fallback?: string;
    text?: string;
    pretext?: string;
    title?: string;
    title_link?: string;
  }>;
  // Bot messages
  bot_id?: string;
  username?: string; // For bot messages
  // Subtype for special messages
  subtype?: string;
}

// Conversation history response
export interface SlackConversationHistoryResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

// Conversations list response
export interface SlackConversationsListResponse {
  ok: boolean;
  channels: SlackChannel[];
  response_metadata?: {
    next_cursor?: string;
  };
  error?: string;
}

// Users info response
export interface SlackUsersInfoResponse {
  ok: boolean;
  user: SlackUser;
  error?: string;
}

// Message type for classification
export type SlackMessageType =
  | 'direct_mention' // @mentioned the bot/user
  | 'channel_message' // Regular channel message
  | 'direct_message' // DM to the bot/user
  | 'thread_reply' // Reply in a thread
  | 'bot_message'; // Message from a bot

// Enrichment stored in inbox_items
export interface SlackEnrichment {
  // Message context
  messageType: SlackMessageType;
  channelId: string;
  channelName: string;
  threadTs?: string; // If part of a thread
  replyCount?: number;

  // Reactions
  reactions?: Array<{
    name: string;
    count: number;
  }>;

  // File attachments
  hasFiles: boolean;
  fileCount?: number;

  // User info
  userId?: string;
  userDisplayName?: string;

  // Links
  slackUrl: string;

  // Standard enrichment fields
  summary?: string;
  linkedEntities?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

// Sync result
export interface SlackSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  channels?: string[];
  error?: string;
  errorMessages?: string[];
}

// Sync state persisted
export interface SlackSyncState {
  lastSyncAt?: string;
  // Track last message ts per channel to avoid re-syncing
  channelCursors?: Record<string, string>;
}

// Search result match from search.messages API
export interface SlackSearchMatch {
  type: string;
  ts: string;
  text: string;
  user?: string;
  username?: string;
  channel: {
    id: string;
    name: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
  };
  permalink: string;
  // Thread info
  thread_ts?: string;
  reply_count?: number;
}

// Search response
export interface SlackSearchResponse {
  ok: boolean;
  query: string;
  messages: {
    total: number;
    matches: SlackSearchMatch[];
    paging: {
      count: number;
      total: number;
      page: number;
      pages: number;
    };
  };
  error?: string;
}

// Configuration for which channels to monitor
export interface SlackConfig {
  // If set, only sync these channels (by name or ID)
  channels?: string[];
  // If true, sync DMs to the bot
  includeDMs?: boolean;
  // If true, include bot messages
  includeBotMessages?: boolean;
  // Only sync messages mentioning the bot/user
  onlyMentions?: boolean;
}
