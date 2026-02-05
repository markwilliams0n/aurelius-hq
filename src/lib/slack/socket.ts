/**
 * Slack Socket Mode Listener
 *
 * Connects to Slack via Socket Mode and listens for:
 * - DMs to the bot
 * - @mentions of the bot in channels
 *
 * When messages arrive, they're saved to the triage inbox.
 */

import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { chat } from '@/lib/ai/client';
import type { SlackEnrichment, SlackMessageType } from './types';
import type { NewInboxItem } from '@/lib/db/schema/triage';

/**
 * AI analysis result for a Slack message
 */
interface MessageAnalysis {
  summary: string;
  suggestedTasks: Array<{
    title: string;
    description?: string;
    priority?: 'high' | 'medium' | 'low';
  }>;
  hasExplicitInstruction: boolean;
}

let socketClient: SocketModeClient | null = null;
let webClient: WebClient | null = null;
let isConnected = false;

/**
 * Check if Socket Mode is configured
 */
export function isSocketConfigured(): boolean {
  return !!(process.env.SLACK_APP_TOKEN && process.env.SLACK_BOT_TOKEN);
}

/**
 * Get or create the Socket Mode client
 */
function getSocketClient(): SocketModeClient {
  if (!socketClient) {
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!appToken) {
      throw new Error('SLACK_APP_TOKEN not configured');
    }
    socketClient = new SocketModeClient({ appToken });
  }
  return socketClient;
}

/**
 * Get or create the Web API client
 */
function getWebClient(): WebClient {
  if (!webClient) {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      throw new Error('SLACK_BOT_TOKEN not configured');
    }
    webClient = new WebClient(botToken);
  }
  return webClient;
}

/**
 * Check if a message already exists in triage
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
 * Get user info from Slack
 */
async function getUserInfo(userId: string): Promise<{
  name: string;
  realName?: string;
  avatar?: string;
} | null> {
  try {
    const web = getWebClient();
    const result = await web.users.info({ user: userId });
    if (result.ok && result.user) {
      return {
        name: result.user.name || userId,
        realName: result.user.real_name,
        avatar: result.user.profile?.image_72,
      };
    }
  } catch (error) {
    console.error(`[Slack] Failed to get user info for ${userId}:`, error);
  }
  return null;
}

/**
 * Get channel info from Slack
 */
async function getChannelInfo(channelId: string): Promise<{
  name: string;
  isIm: boolean;
  isMpim: boolean;
} | null> {
  try {
    const web = getWebClient();
    const result = await web.conversations.info({ channel: channelId });
    if (result.ok && result.channel) {
      return {
        name: result.channel.name || 'DM',
        isIm: result.channel.is_im || false,
        isMpim: result.channel.is_mpim || false,
      };
    }
  } catch (error) {
    console.error(`[Slack] Failed to get channel info for ${channelId}:`, error);
  }
  return null;
}

/**
 * Build permalink for a message
 */
async function getPermalink(channelId: string, messageTs: string): Promise<string | null> {
  try {
    const web = getWebClient();
    const result = await web.chat.getPermalink({
      channel: channelId,
      message_ts: messageTs,
    });
    return result.ok ? result.permalink || null : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all messages in a thread
 */
async function getThreadReplies(channelId: string, threadTs: string): Promise<{
  messages: Array<{
    user?: string;
    userName?: string;
    text: string;
    ts: string;
  }>;
  participantNames: string[];
} | null> {
  try {
    const web = getWebClient();
    const result = await web.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 100, // Get up to 100 messages in the thread
    });

    if (!result.ok || !result.messages?.length) {
      return null;
    }

    // Get unique user IDs from the thread
    const userIds = new Set<string>();
    for (const msg of result.messages) {
      if (msg.user) userIds.add(msg.user);
    }

    // Fetch user names
    const userNames: Record<string, string> = {};
    for (const userId of userIds) {
      const userInfo = await getUserInfo(userId);
      if (userInfo) {
        userNames[userId] = userInfo.realName || userInfo.name;
      }
    }

    const messages = result.messages.map((msg) => ({
      user: msg.user,
      userName: msg.user ? userNames[msg.user] || msg.user : 'Unknown',
      text: msg.text || '',
      ts: msg.ts || '',
    }));

    return {
      messages,
      participantNames: Object.values(userNames),
    };
  } catch (error) {
    console.error('[Slack] Failed to fetch thread replies:', error);
    return null;
  }
}

/**
 * Format a thread into readable text
 */
function formatThread(thread: {
  messages: Array<{ userName?: string; text: string; ts: string }>;
}): string {
  return thread.messages
    .map((msg) => {
      const time = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `[${time}] ${msg.userName}: ${msg.text}`;
    })
    .join('\n\n');
}

/**
 * Analyze a message with AI to generate summary and suggested tasks
 */
async function analyzeMessage(
  content: string,
  mentionText?: string
): Promise<MessageAnalysis> {
  const prompt = `Analyze this Slack message/thread and provide:
1. A brief summary (1-2 sentences)
2. Any actionable tasks that should be created
3. Whether the user gave an explicit instruction (like "make a task to..." or "remind me to..." or "add to...")

${mentionText ? `The user @mentioned the bot with: "${mentionText}"` : ''}

Message content:
${content}

Respond in JSON format:
{
  "summary": "Brief summary of the content",
  "suggestedTasks": [
    {"title": "Task title", "description": "Optional details", "priority": "high|medium|low"}
  ],
  "hasExplicitInstruction": true/false
}

If there are no clear tasks, return an empty array for suggestedTasks.
If the user explicitly asked to create a task, make sure hasExplicitInstruction is true and include that task.`;

  try {
    const response = await chat(prompt);

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const result = JSON.parse(jsonStr.trim());
    return {
      summary: result.summary || '',
      suggestedTasks: result.suggestedTasks || [],
      hasExplicitInstruction: result.hasExplicitInstruction || false,
    };
  } catch (error) {
    console.error('[Slack] AI analysis failed:', error);
    return {
      summary: '',
      suggestedTasks: [],
      hasExplicitInstruction: false,
    };
  }
}

/**
 * Save a message to the triage inbox
 */
async function saveToInbox(event: {
  type: string;
  channel: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel_type?: string;
  originalSender?: string;  // For forwarded messages
  originalSource?: string;  // e.g., "Direct Message | Today at 07:49"
  isThread?: boolean;       // Whether this is a full thread capture
  threadParticipants?: string[];  // Names of thread participants
  mentionText?: string;     // The text of the @mention (for instruction detection)
}): Promise<void> {
  const {
    channel, user, text, ts, thread_ts, channel_type,
    originalSender, originalSource, isThread, threadParticipants, mentionText
  } = event;

  // Skip if already exists
  if (await messageExists(channel, ts)) {
    console.log(`[Slack] Message ${ts} already in triage, skipping`);
    return;
  }

  // Get user info (forwarder)
  const userInfo = user ? await getUserInfo(user) : null;
  const forwarderName = userInfo?.realName || userInfo?.name || 'Unknown';

  // For forwarded messages, use original sender; otherwise use forwarder
  const isForwarded = !!originalSender;
  const senderName = originalSender || forwarderName;

  // Get channel info
  const channelInfo = await getChannelInfo(channel);
  const isIm = channelInfo?.isIm || channel_type === 'im';
  const isMpim = channelInfo?.isMpim || channel_type === 'mpim';

  // Determine message type
  const messageType: SlackMessageType = isIm || isMpim ? 'direct_message' : 'direct_mention';

  // Build subject based on type
  let subject: string;
  if (isThread && threadParticipants?.length) {
    // Thread capture - show participants
    const participantList = threadParticipants.slice(0, 3).join(', ');
    const more = threadParticipants.length > 3 ? ` +${threadParticipants.length - 3}` : '';
    subject = `Thread: ${participantList}${more}`;
  } else if (isForwarded) {
    subject = `Slack from ${senderName}`;
    if (originalSource) {
      // Extract channel/DM info from source like "Direct Message | Today at 07:49"
      const sourceType = originalSource.split('|')[0]?.trim();
      if (sourceType && sourceType !== 'Direct Message') {
        subject = `${sourceType}: ${senderName}`;
      }
    }
  } else if (isIm || isMpim) {
    subject = `DM from ${senderName}`;
  } else {
    subject = `#${channelInfo?.name || 'channel'}: ${senderName}`;
  }

  // Get permalink
  const permalink = await getPermalink(channel, ts);

  // Build enrichment
  const enrichment: SlackEnrichment & {
    isForwarded?: boolean;
    forwardedBy?: string;
    originalSource?: string;
    isThread?: boolean;
    threadParticipants?: string[];
  } = {
    messageType,
    channelId: channel,
    channelName: channelInfo?.name || 'DM',
    threadTs: thread_ts,
    hasFiles: false,
    userId: user,
    userDisplayName: senderName,
    slackUrl: permalink || '',
  };

  // Add forwarding info if applicable
  if (isForwarded) {
    enrichment.isForwarded = true;
    enrichment.forwardedBy = forwarderName;
    enrichment.originalSource = originalSource;
  }

  // Add thread info if applicable
  if (isThread) {
    enrichment.isThread = true;
    enrichment.threadParticipants = threadParticipants;
  }

  // Build tags
  const tags: string[] = [];
  if (isThread) {
    tags.push('Thread');
  }
  if (isForwarded) {
    tags.push('Forwarded');
  }
  if (isIm || isMpim) {
    tags.push('DM');
  }

  // AI analysis for summary and suggested tasks
  console.log(`[Slack] Analyzing message with AI...`);
  const analysis = await analyzeMessage(text, mentionText);

  if (analysis.summary) {
    (enrichment as Record<string, unknown>).aiSummary = analysis.summary;
  }
  if (analysis.suggestedTasks.length > 0) {
    (enrichment as Record<string, unknown>).suggestedTasks = analysis.suggestedTasks;
    tags.push('Has Tasks');
  }
  if (analysis.hasExplicitInstruction) {
    tags.push('Instruction');
  }

  console.log(`[Slack] Analysis complete: ${analysis.suggestedTasks.length} tasks suggested`);

  // Build inbox item
  const item: NewInboxItem = {
    connector: 'slack',
    externalId: `${channel}:${ts}`,
    sender: user || 'unknown',
    senderName,
    senderAvatar: userInfo?.avatar,
    subject,
    content: text,
    preview: text.slice(0, 200),
    status: 'new',
    priority: 'high', // DMs and mentions are high priority
    tags,
    rawPayload: event as unknown as Record<string, unknown>,
    enrichment: enrichment as unknown as Record<string, unknown>,
    receivedAt: new Date(parseFloat(ts) * 1000),
  };

  // Save to database
  await db.insert(inboxItems).values(item);
  console.log(`[Slack] Saved to triage: ${subject}`);

  // Acknowledge with a reaction
  try {
    const web = getWebClient();
    await web.reactions.add({
      channel,
      timestamp: ts,
      name: 'eyes', // 👀 to show it was received
    });
  } catch {
    // Ignore reaction errors
  }
}

// Cache for triage channel ID (resolved from name)
let triageChannelId: string | null = null;

/**
 * Resolve triage channel name to ID
 */
async function getTriageChannelId(): Promise<string | null> {
  if (triageChannelId) {
    return triageChannelId;
  }

  const channelName = process.env.SLACK_TRIAGE_CHANNEL;
  if (!channelName) {
    return null;
  }

  try {
    const web = getWebClient();
    let cursor: string | undefined;

    // Paginate through all channels to find the triage channel
    do {
      const result = await web.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        cursor,
      });

      const channel = result.channels?.find(
        (c) => c.name === channelName || c.id === channelName
      );

      if (channel?.id) {
        triageChannelId = channel.id;
        console.log(`[Slack] Triage channel resolved: ${channelName} -> ${triageChannelId}`);
        return triageChannelId;
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.error(`[Slack] Triage channel "${channelName}" not found`);
  } catch (error) {
    console.error('[Slack] Failed to resolve triage channel:', error);
  }
  return null;
}

/**
 * Handle incoming Slack events
 */
function setupEventHandlers(client: SocketModeClient): void {
  // Handle messages (DMs and triage channel)
  client.on('message', async ({ event, ack }) => {
    await ack();

    const isDm = event.channel_type === 'im';
    const triageChannel = await getTriageChannelId();
    const isTriageChannel = triageChannel && event.channel === triageChannel;

    // Only process DMs or messages from triage channel
    if (!isDm && !isTriageChannel) {
      return;
    }

    // Skip message edits and deletes
    const skipSubtypes = ['message_changed', 'message_deleted', 'channel_join', 'channel_leave'];
    if (event.subtype && skipSubtypes.includes(event.subtype)) {
      return;
    }

    // Skip bot's own messages
    if (event.bot_id) {
      return;
    }

    // Handle forwarded messages - extract the forwarded content
    let messageText = event.text || '';
    if (event.attachments?.length) {
      // Forwarded messages often come as attachments
      const forwarded = event.attachments.map((att: { text?: string; fallback?: string; pretext?: string; author_name?: string; from_url?: string }) => {
        const parts: string[] = [];
        if (att.author_name) parts.push(`From: ${att.author_name}`);
        if (att.text) parts.push(att.text);
        else if (att.fallback) parts.push(att.fallback);
        if (att.from_url) parts.push(`Source: ${att.from_url}`);
        return parts.join('\n');
      }).filter(Boolean).join('\n---\n');
      if (forwarded) {
        messageText = messageText ? `${messageText}\n\n${forwarded}` : forwarded;
      }
    }

    // Skip if no content
    if (!messageText.trim()) {
      console.log('[Slack] Skipping empty message');
      return;
    }

    const source = isDm ? 'DM' : `#${process.env.SLACK_TRIAGE_CHANNEL}`;
    console.log(`[Slack] Received ${source} from ${event.user}: ${messageText.slice(0, 50)}...`);

    try {
      await saveToInbox({
        type: 'message',
        channel: event.channel,
        user: event.user,
        text: messageText,
        ts: event.ts,
        thread_ts: event.thread_ts,
        channel_type: event.channel_type,
      });
    } catch (error) {
      console.error('[Slack] Failed to save message:', error);
    }
  });

  // Handle @mentions (including forwarded messages and threads)
  client.on('app_mention', async ({ event, ack }) => {
    await ack();

    // Skip bot's own messages
    if (event.bot_id) {
      return;
    }

    // Capture the mention text (what the user typed after @Aurelius)
    const mentionText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

    // Check if this is in a thread - if so, fetch the full thread
    const threadTs = event.thread_ts || event.ts;
    const isInThread = !!event.thread_ts;

    let messageText = '';
    let originalSender: string | undefined;
    let originalSource: string | undefined;
    let threadParticipants: string[] = [];

    if (isInThread) {
      // Fetch the entire thread
      console.log(`[Slack] Mention in thread ${threadTs}, fetching full thread...`);
      const thread = await getThreadReplies(event.channel, threadTs);

      if (thread && thread.messages.length > 0) {
        messageText = formatThread(thread);
        threadParticipants = thread.participantNames;
        console.log(`[Slack] Thread has ${thread.messages.length} messages from ${threadParticipants.join(', ')}`);
      } else {
        // Fallback to just the mention message
        messageText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      }
    } else {
      // Not in a thread - extract text, including forwarded message content
      messageText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

      if (event.attachments?.length) {
        // Extract forwarded message content
        const forwardedParts: string[] = [];
        for (const att of event.attachments) {
          if (att.author_name) {
            originalSender = att.author_name;
          }
          if (att.footer) {
            originalSource = att.footer;
          }
          if (att.text) {
            forwardedParts.push(att.text);
          } else if (att.fallback) {
            forwardedParts.push(att.fallback);
          }
        }
        if (forwardedParts.length) {
          messageText = forwardedParts.join('\n');
        }
      }
    }

    // Skip if no content
    if (!messageText.trim()) {
      console.log('[Slack] Skipping empty mention');
      return;
    }

    const contextInfo = isInThread
      ? `thread with ${threadParticipants.length} participants`
      : originalSender
        ? `forwarded from ${originalSender}`
        : 'direct mention';
    console.log(`[Slack] Mention from ${event.user} (${contextInfo}): ${messageText.slice(0, 50)}...`);

    try {
      await saveToInbox({
        type: 'app_mention',
        channel: event.channel,
        user: event.user,
        text: messageText,
        ts: event.ts,
        thread_ts: event.thread_ts,
        originalSender,
        originalSource,
        isThread: isInThread,
        threadParticipants: isInThread ? threadParticipants : undefined,
        mentionText, // Pass the instruction text for AI analysis
      });
    } catch (error) {
      console.error('[Slack] Failed to save mention:', error);
    }
  });
}

/**
 * Start the Socket Mode connection
 */
export async function startSocketMode(): Promise<void> {
  if (!isSocketConfigured()) {
    console.log('[Slack] Socket Mode not configured, skipping');
    return;
  }

  if (isConnected) {
    console.log('[Slack] Socket Mode already connected');
    return;
  }

  try {
    const client = getSocketClient();
    setupEventHandlers(client);

    await client.start();
    isConnected = true;
    console.log('[Slack] Socket Mode connected - listening for DMs and @mentions');
  } catch (error) {
    console.error('[Slack] Failed to start Socket Mode:', error);
    throw error;
  }
}

/**
 * Stop the Socket Mode connection
 */
export async function stopSocketMode(): Promise<void> {
  if (socketClient && isConnected) {
    await socketClient.disconnect();
    isConnected = false;
    console.log('[Slack] Socket Mode disconnected');
  }
}

/**
 * Get connection status
 */
export function getSocketStatus(): { connected: boolean; configured: boolean } {
  return {
    connected: isConnected,
    configured: isSocketConfigured(),
  };
}
