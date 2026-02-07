/**
 * Slack Workspace Directory Cache
 *
 * Syncs and caches all Slack users and channels locally so the agent
 * can resolve names to IDs without hitting the Slack API every time.
 *
 * Stored via the app's config system (slack:directory key).
 * Auto-refreshes every 24 hours via heartbeat.
 */

import { WebClient } from '@slack/web-api';
import { getConfig, updateConfig } from '@/lib/config';

// ── Types ──────────────────────────────────────────────────────────

export interface SlackDirectoryUser {
  id: string;
  name: string;        // Slack username
  realName: string;
  displayName: string;
  avatar?: string;
  deleted: boolean;
}

export interface SlackDirectoryChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;   // is the bot a member
}

export interface SlackDirectory {
  users: SlackDirectoryUser[];
  channels: SlackDirectoryChannel[];
  botUserId: string;     // the bot's user ID
  myUserId: string;      // Mark's user ID (for group DMs)
  lastRefreshed: string; // ISO timestamp
}

export type UserResolveResult =
  | { found: true; user: SlackDirectoryUser }
  | { found: false; suggestions: SlackDirectoryUser[] };

// ── Internal helpers ───────────────────────────────────────────────

function getWebClient(): WebClient {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }
  return new WebClient(botToken);
}

// ── Main sync function ─────────────────────────────────────────────

/**
 * Sync the full Slack workspace directory (users + channels).
 * Skips if last refresh was less than 24 hours ago unless force=true.
 */
export async function syncSlackDirectory(options?: { force?: boolean }): Promise<SlackDirectory> {
  // Check if we can skip
  if (!options?.force) {
    const existing = await getDirectory();
    if (existing) {
      const lastRefreshed = new Date(existing.lastRefreshed).getTime();
      const hoursSince = (Date.now() - lastRefreshed) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        console.log(`[Slack Directory] Skipping sync — last refreshed ${hoursSince.toFixed(1)}h ago`);
        return existing;
      }
    }
  }

  console.log('[Slack Directory] Starting sync...');
  const web = getWebClient();

  // 1. Get bot identity
  const authResult = await web.auth.test();
  const botUserId = authResult.user_id as string;
  console.log(`[Slack Directory] Bot user ID: ${botUserId}`);

  // 2. Paginate users.list — keep real humans only
  const users: SlackDirectoryUser[] = [];
  let userCursor: string | undefined;

  do {
    const result = await web.users.list({
      limit: 200,
      cursor: userCursor,
    });

    if (result.members) {
      for (const member of result.members) {
        // Skip bots and Slackbot
        if (member.is_bot || member.id === 'USLACKBOT') {
          continue;
        }

        users.push({
          id: member.id!,
          name: member.name || '',
          realName: member.real_name || member.name || '',
          displayName: member.profile?.display_name || member.real_name || member.name || '',
          avatar: member.profile?.image_72 || member.profile?.image_48,
          deleted: member.deleted || false,
        });
      }
    }

    userCursor = result.response_metadata?.next_cursor || undefined;
  } while (userCursor);

  console.log(`[Slack Directory] Found ${users.length} users (${users.filter(u => !u.deleted).length} active)`);

  // 3. Paginate conversations.list — public + private channels
  const channels: SlackDirectoryChannel[] = [];
  let channelCursor: string | undefined;

  do {
    const result = await web.conversations.list({
      limit: 200,
      exclude_archived: true,
      types: 'public_channel,private_channel',
      cursor: channelCursor,
    });

    if (result.channels) {
      for (const channel of result.channels) {
        channels.push({
          id: channel.id!,
          name: channel.name || '',
          isPrivate: channel.is_private || false,
          isMember: channel.is_member || false,
        });
      }
    }

    channelCursor = result.response_metadata?.next_cursor || undefined;
  } while (channelCursor);

  console.log(`[Slack Directory] Found ${channels.length} channels (${channels.filter(c => c.isMember).length} joined)`);

  // 4. Determine myUserId — from env or leave empty
  const myUserId = process.env.SLACK_MY_USER_ID || '';
  if (!myUserId) {
    console.log('[Slack Directory] SLACK_MY_USER_ID not set — will be empty. Set it in .env for group DM resolution.');
  }

  // 5. Build and store directory
  const directory: SlackDirectory = {
    users,
    channels,
    botUserId,
    myUserId,
    lastRefreshed: new Date().toISOString(),
  };

  await updateConfig('slack:directory', JSON.stringify(directory), 'aurelius');
  console.log(`[Slack Directory] Sync complete — ${users.length} users, ${channels.length} channels cached`);

  return directory;
}

// ── Read cached directory ──────────────────────────────────────────

/**
 * Load the cached directory from the config DB.
 * Returns null if not yet synced.
 */
export async function getDirectory(): Promise<SlackDirectory | null> {
  const config = await getConfig('slack:directory');
  if (!config?.content) {
    return null;
  }

  try {
    return JSON.parse(config.content) as SlackDirectory;
  } catch {
    console.error('[Slack Directory] Failed to parse cached directory');
    return null;
  }
}

// ── Name resolution ────────────────────────────────────────────────

/**
 * Resolve a name to a Slack user.
 *
 * Matching priority:
 * 1. Exact match on displayName or username (case-insensitive)
 * 2. Fuzzy match on realName (first-name match, case-insensitive)
 *
 * Returns { found: true, user } for exact matches,
 * { found: false, suggestions } for ambiguous or no matches.
 */
export async function resolveUser(name: string): Promise<UserResolveResult> {
  const directory = await getDirectory();
  if (!directory) {
    return { found: false, suggestions: [] };
  }

  const query = name.toLowerCase().trim();
  const activeUsers = directory.users.filter(u => !u.deleted);

  // 1. Exact match on displayName or username
  const exactMatch = activeUsers.find(
    u =>
      u.displayName.toLowerCase() === query ||
      u.name.toLowerCase() === query
  );

  if (exactMatch) {
    return { found: true, user: exactMatch };
  }

  // 2. Fuzzy match on realName (case-insensitive contains, or first-name match)
  const fuzzyMatches = activeUsers.filter(u => {
    const realNameLower = u.realName.toLowerCase();
    const firstName = realNameLower.split(' ')[0];
    if (firstName === query) return true;
    if (realNameLower.includes(query)) return true;
    return false;
  });

  if (fuzzyMatches.length === 1) {
    return { found: true, user: fuzzyMatches[0] };
  }

  if (fuzzyMatches.length > 1) {
    return { found: false, suggestions: fuzzyMatches };
  }

  return { found: false, suggestions: [] };
}

/**
 * Resolve a channel name to a channel object.
 * Strips leading # if present.
 * Returns the channel or null if not found.
 */
export async function resolveChannel(name: string): Promise<SlackDirectoryChannel | null> {
  const directory = await getDirectory();
  if (!directory) {
    return null;
  }

  const query = name.replace(/^#/, '').toLowerCase().trim();

  return directory.channels.find(c => c.name.toLowerCase() === query) || null;
}
