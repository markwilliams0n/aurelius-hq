/**
 * Slack API Client
 *
 * Web API client for Slack with bot token auth.
 */

import {
  getSyncState as getConnectorSyncState,
  setSyncState as setConnectorSyncState,
} from '@/lib/connectors/sync-state';
import type {
  SlackMessage,
  SlackChannel,
  SlackUser,
  SlackSyncState,
  SlackConversationHistoryResponse,
  SlackConversationsListResponse,
  SlackUsersInfoResponse,
  SlackSearchMatch,
  SlackSearchResponse,
} from './types';

const SLACK_API_URL = 'https://slack.com/api';

// Cache for user info to avoid repeated API calls (with TTL)
interface CachedUser {
  user: SlackUser;
  cachedAt: number;
}
const userCache = new Map<string, CachedUser>();
const USER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Check if Slack connector is configured
 */
export function isConfigured(): boolean {
  return !!(process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN);
}

/**
 * Get the Slack token (user token preferred, falls back to bot token)
 */
function getToken(): string {
  const token = process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_USER_TOKEN or SLACK_BOT_TOKEN not configured');
  }
  return token;
}

/**
 * Make a Slack API request
 */
async function slackApi<T>(
  method: string,
  params?: Record<string, string | number | boolean>
): Promise<T> {
  const token = getToken();

  const url = new URL(`${SLACK_API_URL}/${method}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack API error: ${response.status} ${text}`);
  }

  const json = await response.json();

  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error || 'Unknown error'}`);
  }

  return json as T;
}

/**
 * Get list of channels the bot is a member of
 */
export async function getChannels(): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string | number | boolean> = {
      types: 'public_channel,private_channel,mpim,im',
      exclude_archived: true,
      limit: 200,
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await slackApi<SlackConversationsListResponse>(
      'conversations.list',
      params
    );

    channels.push(...response.channels);
    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  // Filter to only channels the bot is a member of (or DMs which don't need membership)
  return channels.filter((c) => c.is_member || c.is_im);
}

/**
 * Get messages from a channel
 */
export async function getChannelMessages(
  channelId: string,
  options?: {
    oldest?: string; // Unix timestamp - only get messages after this
    limit?: number;
    cursor?: string;
  }
): Promise<{
  messages: SlackMessage[];
  hasMore: boolean;
  nextCursor?: string;
}> {
  const params: Record<string, string | number | boolean> = {
    channel: channelId,
    limit: options?.limit ?? 100,
  };

  if (options?.oldest) {
    params.oldest = options.oldest;
  }
  if (options?.cursor) {
    params.cursor = options.cursor;
  }

  const response = await slackApi<SlackConversationHistoryResponse>(
    'conversations.history',
    params
  );

  return {
    messages: response.messages,
    hasMore: response.has_more,
    nextCursor: response.response_metadata?.next_cursor,
  };
}

/**
 * Search for messages using Slack's search API
 * Supports modifiers like: is:unread, is:dm, from:user, in:channel
 */
export async function searchMessages(
  query: string,
  options?: {
    count?: number;
    page?: number;
  }
): Promise<{
  matches: SlackSearchMatch[];
  total: number;
  hasMore: boolean;
}> {
  const params: Record<string, string | number | boolean> = {
    query,
    count: options?.count ?? 50,
    page: options?.page ?? 1,
  };

  const response = await slackApi<SlackSearchResponse>('search.messages', params);

  return {
    matches: response.messages.matches,
    total: response.messages.total,
    hasMore: response.messages.paging.page < response.messages.paging.pages,
  };
}

/**
 * Get user info by ID (with caching and TTL)
 */
export async function getUserInfo(userId: string): Promise<SlackUser | null> {
  // Check cache first (with TTL)
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL) {
    return cached.user;
  }

  try {
    const response = await slackApi<SlackUsersInfoResponse>('users.info', {
      user: userId,
    });

    userCache.set(userId, { user: response.user, cachedAt: Date.now() });
    return response.user;
  } catch (error) {
    console.warn(`[Slack] Failed to get user info for ${userId}:`, error);
    return null;
  }
}

/**
 * Get the authenticated bot/user info
 */
export async function getAuthInfo(): Promise<{
  userId: string;
  botId?: string;
  teamId: string;
}> {
  const response = await slackApi<{
    ok: boolean;
    user_id: string;
    bot_id?: string;
    team_id: string;
  }>('auth.test');

  return {
    userId: response.user_id,
    botId: response.bot_id,
    teamId: response.team_id,
  };
}

/**
 * Build a permalink URL to a message
 */
export function buildMessageUrl(
  teamId: string,
  channelId: string,
  messageTs: string
): string {
  // Convert timestamp to URL format (remove the dot)
  const tsForUrl = messageTs.replace('.', '');
  return `https://slack.com/archives/${channelId}/p${tsForUrl}`;
}

/**
 * Get sync state from database
 */
export async function getSyncState(): Promise<SlackSyncState> {
  const state = await getConnectorSyncState<SlackSyncState>('sync:slack');
  return state ?? {};
}

/**
 * Save sync state to database
 */
export async function saveSyncState(state: SlackSyncState): Promise<void> {
  await setConnectorSyncState('sync:slack', state as Record<string, unknown>);
}

/**
 * Parse Slack message text to extract mentions
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

/**
 * Clean Slack message text (replace user IDs with names, etc.)
 */
export async function cleanMessageText(text: string): Promise<string> {
  // Replace user mentions with display names
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  let cleanedText = text;

  const mentions = extractMentions(text);
  for (const userId of mentions) {
    const user = await getUserInfo(userId);
    const displayName =
      user?.profile?.display_name || user?.real_name || user?.name || userId;
    cleanedText = cleanedText.replace(`<@${userId}>`, `@${displayName}`);
  }

  // Replace channel mentions
  cleanedText = cleanedText.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2');

  // Replace URLs
  cleanedText = cleanedText.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)');
  cleanedText = cleanedText.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  return cleanedText;
}

/**
 * Determine message type
 */
export function classifyMessage(
  message: SlackMessage,
  channel: SlackChannel,
  authUserId: string
): 'direct_mention' | 'channel_message' | 'direct_message' | 'thread_reply' | 'bot_message' {
  // Bot message
  if (message.bot_id || message.subtype === 'bot_message') {
    return 'bot_message';
  }

  // DM
  if (channel.is_im) {
    return 'direct_message';
  }

  // Thread reply
  if (message.thread_ts && message.thread_ts !== message.ts) {
    return 'thread_reply';
  }

  // Direct mention
  const mentions = extractMentions(message.text);
  if (mentions.includes(authUserId)) {
    return 'direct_mention';
  }

  return 'channel_message';
}

/**
 * Get display name for a user
 */
export async function getDisplayName(userId: string): Promise<string> {
  const user = await getUserInfo(userId);
  return (
    user?.profile?.display_name ||
    user?.real_name ||
    user?.name ||
    'Unknown User'
  );
}

/**
 * Get avatar URL for a user
 */
export async function getAvatarUrl(userId: string): Promise<string | undefined> {
  const user = await getUserInfo(userId);
  return user?.profile?.image_72 || user?.profile?.image_48;
}
