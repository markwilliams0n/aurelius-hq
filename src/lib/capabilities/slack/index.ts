import type { Capability, ToolDefinition, ToolResult } from '../types';
import { resolveUser, resolveChannel, getDirectory } from '@/lib/slack/directory';
import { sendDirectMessage, sendChannelMessage, canSendAsUser } from '@/lib/slack/actions';

const PROMPT = `# Slack Messaging

You can send Slack messages using send_slack_message.
- For DMs, use the person's first name (e.g., "harvy", "katie")
- For channels, use #channel-name (e.g., "#general", "#aurelius-hq")
- Messages use Slack mrkdwn format (*bold*, _italic_, \`code\`)
- Messages are always drafted for user approval — never sent automatically
- DMs are sent as group DMs that include Mark
- Channel posts include a @Mark mention
- Over time, use memory context to suggest appropriate recipients

## When to use

- User asks you to message someone ("DM harvy about the invoice")
- User asks you to post to a channel ("post the update to #marketing")
- You want to send a reminder or notification to the user
- Triage follow-ups that need Slack communication

## How it works

1. You call send_slack_message with recipient and message
2. The system resolves the recipient name to a Slack user/channel
3. An Action Card appears for the user to review the draft
4. User confirms → message is sent via Slack API
5. Card updates with "Sent" status and permalink`;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'send_slack_message',
    description:
      'Draft a Slack message to a person or channel. Returns an action card for user confirmation — never sends directly.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            'Recipient: a person name (e.g. "harvy") or #channel-name (e.g. "#general")',
        },
        message: {
          type: 'string',
          description: 'Message content in Slack mrkdwn format',
        },
        thread_ts: {
          type: 'string',
          description: 'Optional thread timestamp to reply in a thread',
        },
      },
      required: ['to', 'message'],
    },
  },
];

async function handleSlackTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (toolName !== 'send_slack_message') return null;

  const to = String(toolInput.to || '');
  const message = String(toolInput.message || '');
  const threadTs = toolInput.thread_ts ? String(toolInput.thread_ts) : undefined;

  if (!to || !message) {
    return { result: JSON.stringify({ error: 'Both "to" and "message" are required' }) };
  }

  const directory = await getDirectory();
  if (!directory) {
    return { result: JSON.stringify({ error: 'Slack directory not synced yet. Run heartbeat first.' }) };
  }

  // Use directory cache, fall back to env if stale
  const myUserId = directory.myUserId || process.env.SLACK_MY_USER_ID || '';

  const isChannel = to.startsWith('#');

  if (isChannel) {
    // Channel message
    const channel = await resolveChannel(to);
    if (!channel) {
      return {
        result: JSON.stringify({
          error: `Channel "${to}" not found. Available channels: ${directory.channels
            .filter(c => c.isMember)
            .slice(0, 10)
            .map(c => `#${c.name}`)
            .join(', ')}`,
        }),
      };
    }

    // Return action card data for the SSE stream
    const cardData = {
      cardType: 'slack_message' as const,
      recipientType: 'channel' as const,
      recipientId: channel.id,
      recipientName: `#${channel.name}`,
      channelName: channel.name,
      includeMe: true,
      message,
      threadTs,
      myUserId,
      sendAs: 'user' as const,
      canSendAsUser: canSendAsUser(),
    };

    return {
      result: JSON.stringify({
        action_card: {
          cardType: 'slack_message',
          status: 'pending',
          data: cardData,
          actions: ['send', 'edit', 'cancel'],
        },
        summary: `Drafted message for #${channel.name}`,
      }),
    };
  } else {
    // DM to a person
    const resolved = await resolveUser(to);

    if (!resolved.found) {
      if (resolved.suggestions.length > 0) {
        return {
          result: JSON.stringify({
            error: `Ambiguous recipient "${to}". Did you mean: ${resolved.suggestions.map(u => `${u.realName} (@${u.name})`).join(', ')}?`,
          }),
        };
      }
      return {
        result: JSON.stringify({
          error: `User "${to}" not found in workspace directory.`,
        }),
      };
    }

    const user = resolved.user;

    const cardData = {
      cardType: 'slack_message' as const,
      recipientType: 'dm' as const,
      recipientId: user.id,
      recipientName: user.realName || user.displayName,
      recipient: user.realName || user.displayName,
      channelName: null,
      includeMe: true,
      message,
      myUserId,
      sendAs: 'user' as const,
      canSendAsUser: canSendAsUser(),
    };

    return {
      result: JSON.stringify({
        action_card: {
          cardType: 'slack_message',
          status: 'pending',
          data: cardData,
          actions: ['send', 'edit', 'cancel'],
        },
        summary: `Drafted DM for ${user.realName || user.displayName}`,
      }),
    };
  }
}

export const slackCapability: Capability = {
  name: 'slack',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleSlackTool,
};
