/**
 * Slack Sending Actions
 *
 * Low-level functions that send messages via the Slack API.
 * Used by the Slack capability handler after user confirmation.
 */

import { WebClient } from '@slack/web-api';

export type SendAs = 'bot' | 'user';

function getWebClient(sendAs: SendAs = 'bot'): WebClient {
  if (sendAs === 'user') {
    const userToken = process.env.SLACK_USER_TOKEN;
    if (!userToken) {
      throw new Error('SLACK_USER_TOKEN not configured — cannot send as user');
    }
    return new WebClient(userToken);
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }
  return new WebClient(botToken);
}

/** Check if user token is available */
export function canSendAsUser(): boolean {
  return !!process.env.SLACK_USER_TOKEN;
}

export interface SendResult {
  ok: boolean;
  channelId: string;
  ts: string;
  permalink?: string;
  error?: string;
}

/**
 * Send a DM. When sendAs=bot, uses a group DM (MPIM) so Mark stays in the loop.
 * When sendAs=user, sends a direct 1:1 DM from Mark's account.
 */
export async function sendDirectMessage(
  recipientUserId: string,
  myUserId: string,
  message: string,
  sendAs: SendAs = 'bot'
): Promise<SendResult> {
  const effectiveMyUserId = myUserId || process.env.SLACK_MY_USER_ID || '';

  try {
    if (sendAs === 'user') {
      // Send as Mark — direct 1:1 DM from Mark's account
      const web = getWebClient('user');
      const convo = await web.conversations.open({ users: recipientUserId });
      const channelId = convo.channel?.id;
      if (!channelId) {
        return { ok: false, channelId: '', ts: '', error: 'Failed to open DM' };
      }

      const result = await web.chat.postMessage({ channel: channelId, text: message });
      const permalink = await getPermalink(web, channelId, result.ts as string);
      return { ok: true, channelId, ts: result.ts as string, permalink };
    }

    // Send as Aurelius bot — group DM with both users
    const web = getWebClient('bot');
    const users = effectiveMyUserId
      ? `${recipientUserId},${effectiveMyUserId}`
      : recipientUserId;
    const convo = await web.conversations.open({ users });
    const channelId = convo.channel?.id;
    if (!channelId) {
      return { ok: false, channelId: '', ts: '', error: 'Failed to open group DM' };
    }

    const result = await web.chat.postMessage({ channel: channelId, text: message });
    const permalink = await getPermalink(web, channelId, result.ts as string);
    return { ok: true, channelId, ts: result.ts as string, permalink };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Slack Actions] sendDirectMessage failed:', errMsg);
    return { ok: false, channelId: '', ts: '', error: errMsg };
  }
}

/**
 * Send a message to a channel. When sendAs=bot, appends a cc @mention.
 * When sendAs=user, sends from Mark's account with no cc.
 */
export async function sendChannelMessage(
  channelId: string,
  myUserId: string,
  message: string,
  threadTs?: string,
  sendAs: SendAs = 'bot'
): Promise<SendResult> {
  const effectiveMyUserId = myUserId || process.env.SLACK_MY_USER_ID || '';

  try {
    if (sendAs === 'user') {
      // Send as Mark — no cc needed
      const web = getWebClient('user');
      const result = await web.chat.postMessage({
        channel: channelId,
        text: message,
        thread_ts: threadTs,
      });
      const permalink = await getPermalink(web, channelId, result.ts as string);
      return { ok: true, channelId, ts: result.ts as string, permalink };
    }

    // Send as Aurelius bot — auto-join + cc mention
    const web = getWebClient('bot');
    try {
      await web.conversations.join({ channel: channelId });
    } catch {
      // Already a member, or private channel
    }

    const fullMessage = effectiveMyUserId
      ? `${message}\n\ncc <@${effectiveMyUserId}>`
      : message;

    const result = await web.chat.postMessage({
      channel: channelId,
      text: fullMessage,
      thread_ts: threadTs,
    });
    const permalink = await getPermalink(web, channelId, result.ts as string);
    return { ok: true, channelId, ts: result.ts as string, permalink };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Slack Actions] sendChannelMessage failed:', errMsg);
    return { ok: false, channelId, ts: '', error: errMsg };
  }
}

async function getPermalink(web: WebClient, channelId: string, ts: string): Promise<string | undefined> {
  try {
    const result = await web.chat.getPermalink({ channel: channelId, message_ts: ts });
    return result.permalink;
  } catch {
    return undefined;
  }
}
