/**
 * Slack Sync
 *
 * Syncs unread Slack DMs and mentions to triage inbox using search API.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  isConfigured,
  searchMessages,
  getAuthInfo,
  getSyncState,
  saveSyncState,
  getDisplayName,
  getAvatarUrl,
  cleanMessageText,
} from './client';
import type {
  SlackSearchMatch,
  SlackEnrichment,
  SlackSyncResult,
  SlackMessageType,
} from './types';
import type { NewInboxItem } from '@/lib/db/schema/triage';

/**
 * Check if a message is already in triage
 */
async function messageExists(channelId: string, messageTs: string): Promise<boolean> {
  const externalId = `${channelId}:${messageTs}`;
  const existing = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'slack'),
        eq(inboxItems.externalId, externalId)
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Determine message type from search result
 */
function classifySearchMatch(match: SlackSearchMatch): SlackMessageType {
  if (match.channel.is_im) {
    return 'direct_message';
  }
  if (match.channel.is_mpim) {
    return 'direct_message'; // Group DM
  }
  // If it came from a mention search, it's a mention
  return 'direct_mention';
}

/**
 * Generate tags based on message properties
 */
function generateTags(
  messageType: SlackMessageType,
  match: SlackSearchMatch
): string[] {
  const tags: string[] = [];

  if (messageType === 'direct_message') {
    tags.push('DM');
  } else if (messageType === 'direct_mention') {
    tags.push('Mentioned');
  }

  // Channel tag for non-DMs
  if (!match.channel.is_im && !match.channel.is_mpim && match.channel.name) {
    tags.push(`#${match.channel.name}`);
  }

  return tags;
}

/**
 * Map priority based on message type
 */
function mapPriority(messageType: SlackMessageType): 'urgent' | 'high' | 'normal' | 'low' {
  switch (messageType) {
    case 'direct_mention':
      return 'high';
    case 'direct_message':
      return 'high';
    default:
      return 'normal';
  }
}

/**
 * Build subject line from search match
 */
function buildSubject(
  match: SlackSearchMatch,
  senderName: string
): string {
  if (match.channel.is_im || match.channel.is_mpim) {
    return `DM from ${senderName}`;
  }
  // For channel mentions, show channel and preview
  const preview = match.text.slice(0, 40);
  const truncated = match.text.length > 40 ? '...' : '';
  return `#${match.channel.name}: ${preview}${truncated}`;
}

/**
 * Map a search match to an inbox item
 */
async function mapSearchMatchToInboxItem(
  match: SlackSearchMatch,
  authUserId: string
): Promise<NewInboxItem> {
  const messageType = classifySearchMatch(match);

  // Get sender info
  const senderId = match.user || 'unknown';
  const senderName = match.username || (await getDisplayName(senderId));
  const senderAvatar = match.user ? await getAvatarUrl(match.user) : undefined;

  // Clean message text
  const cleanedText = await cleanMessageText(match.text);

  // Build subject
  const subject = buildSubject(match, senderName);

  // Build enrichment
  const enrichment: SlackEnrichment = {
    messageType,
    channelId: match.channel.id,
    channelName: match.channel.name || 'DM',
    threadTs: match.thread_ts,
    replyCount: match.reply_count,
    hasFiles: false,
    userId: match.user,
    userDisplayName: senderName,
    slackUrl: match.permalink,
  };

  // External ID is channel:ts (unique per message)
  const externalId = `${match.channel.id}:${match.ts}`;

  return {
    connector: 'slack',
    externalId,

    // Sender info
    sender: senderId,
    senderName,
    senderAvatar,

    // Content
    subject,
    content: cleanedText,
    preview: cleanedText.slice(0, 200),

    // Triage state
    status: 'new',
    priority: mapPriority(messageType),
    tags: generateTags(messageType, match),

    // Raw data
    rawPayload: match as unknown as Record<string, unknown>,

    // Enrichment
    enrichment: enrichment as unknown as Record<string, unknown>,

    // Timestamps - Slack ts is Unix timestamp
    receivedAt: new Date(parseFloat(match.ts) * 1000),
  };
}

/**
 * Sync unread Slack messages to triage inbox using search API
 */
export async function syncSlackMessages(): Promise<SlackSyncResult> {
  // Check configuration
  if (!isConfigured()) {
    return { synced: 0, skipped: 0, errors: 0, error: 'SLACK_USER_TOKEN or SLACK_BOT_TOKEN not configured' };
  }

  console.log('[Slack] Starting unread message sync via search...');

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  const searches: string[] = [];

  try {
    // Get auth info
    const authInfo = await getAuthInfo();
    console.log(`[Slack] Authenticated as user ${authInfo.userId}`);

    // Search queries to run
    const queries: string[] = [];

    // Always search for unread DMs
    queries.push('is:unread is:dm');

    // Search for unread mentions (in channels)
    // Note: This finds messages where you're @mentioned
    queries.push('is:unread to:me');

    // Process each search query
    for (const query of queries) {
      try {
        console.log(`[Slack] Searching: ${query}`);
        searches.push(query);

        const { matches, total } = await searchMessages(query, { count: 100 });
        console.log(`[Slack] Found ${total} results for "${query}"`);

        for (const match of matches) {
          try {
            // Skip messages from yourself
            if (match.user === authInfo.userId) {
              skipped++;
              continue;
            }

            // Check if already synced
            if (await messageExists(match.channel.id, match.ts)) {
              skipped++;
              continue;
            }

            // Map and insert
            const item = await mapSearchMatchToInboxItem(match, authInfo.userId);
            await db.insert(inboxItems).values(item);

            console.log(`[Slack] Synced: ${item.subject}`);
            synced++;

          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (errorMessages.length < 5) {
              errorMessages.push(`Message ${match.ts}: ${errMsg}`);
            }
            errors++;
          }
        }

        // Rate limit between searches
        if (queries.indexOf(query) < queries.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Slack] Search failed for "${query}":`, errMsg);
        if (errorMessages.length < 5) {
          errorMessages.push(`Search "${query}": ${errMsg}`);
        }
        errors++;
      }
    }

    // Save sync state
    await saveSyncState({
      lastSyncAt: new Date().toISOString(),
    });

    console.log(
      `[Slack] Sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`
    );

    return { synced, skipped, errors, channels: searches, errorMessages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Slack] Sync failed:', message);
    return { synced, skipped, errors, error: message, errorMessages };
  }
}
