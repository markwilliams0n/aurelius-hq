/**
 * Slack Sending Actions
 *
 * Low-level functions that send messages via the Slack API.
 * Used by the Slack capability handler after user confirmation.
 */

import { WebClient } from '@slack/web-api';

function getWebClient(): WebClient {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }
  return new WebClient(botToken);
}

export interface SendResult {
  ok: boolean;
  channelId: string;
  ts: string;
  permalink?: string;
  error?: string;
}

/**
 * Send a DM via group DM (MPIM) so both the recipient and Mark are in the loop.
 *
 * @param recipientUserId - Slack user ID of the recipient
 * @param myUserId - Mark's Slack user ID (included in the group DM)
 * @param message - Message text in Slack mrkdwn format
 */
export async function sendDirectMessage(
  recipientUserId: string,
  myUserId: string,
  message: string
): Promise<SendResult> {
  const web = getWebClient();

  // Fall back to env if myUserId wasn't passed (stale directory cache)
  const effectiveMyUserId = myUserId || process.env.SLACK_MY_USER_ID || '';

  try {
    // Open group DM with both users, or 1:1 DM if myUserId is unavailable
    const users = effectiveMyUserId
      ? `${recipientUserId},${effectiveMyUserId}`
      : recipientUserId;
    const convo = await web.conversations.open({ users });

    const channelId = convo.channel?.id;
    if (!channelId) {
      return { ok: false, channelId: '', ts: '', error: 'Failed to open group DM' };
    }

    // Send the message
    const result = await web.chat.postMessage({
      channel: channelId,
      text: message,
    });

    // Get permalink
    let permalink: string | undefined;
    if (result.ts) {
      try {
        const linkResult = await web.chat.getPermalink({
          channel: channelId,
          message_ts: result.ts,
        });
        permalink = linkResult.permalink;
      } catch {
        // Permalink is optional, don't fail on it
      }
    }

    return {
      ok: true,
      channelId,
      ts: result.ts as string,
      permalink,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Slack Actions] sendDirectMessage failed:', errMsg);
    return { ok: false, channelId: '', ts: '', error: errMsg };
  }
}

/**
 * Send a message to a channel, with a cc @mention for Mark.
 *
 * @param channelId - Slack channel ID
 * @param myUserId - Mark's Slack user ID (for the cc mention)
 * @param message - Message text in Slack mrkdwn format
 * @param threadTs - Optional thread timestamp to reply in a thread
 */
export async function sendChannelMessage(
  channelId: string,
  myUserId: string,
  message: string,
  threadTs?: string
): Promise<SendResult> {
  const web = getWebClient();

  // Fall back to env if myUserId wasn't passed (stale directory cache)
  const effectiveMyUserId = myUserId || process.env.SLACK_MY_USER_ID || '';

  try {
    // Append cc mention
    const fullMessage = effectiveMyUserId
      ? `${message}\n\ncc <@${effectiveMyUserId}>`
      : message;

    const result = await web.chat.postMessage({
      channel: channelId,
      text: fullMessage,
      thread_ts: threadTs,
    });

    // Get permalink
    let permalink: string | undefined;
    if (result.ts) {
      try {
        const linkResult = await web.chat.getPermalink({
          channel: channelId,
          message_ts: result.ts,
        });
        permalink = linkResult.permalink;
      } catch {
        // Permalink is optional
      }
    }

    return {
      ok: true,
      channelId,
      ts: result.ts as string,
      permalink,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Slack Actions] sendChannelMessage failed:', errMsg);
    return { ok: false, channelId, ts: '', error: errMsg };
  }
}
