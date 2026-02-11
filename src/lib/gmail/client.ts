/**
 * Gmail API Client
 *
 * Uses Service Account with domain-wide delegation for Workspace accounts.
 */

import { google } from 'googleapis';
import { existsSync } from 'fs';
import crypto from 'crypto';
import {
  getSyncState as getConnectorSyncState,
  setSyncState as setConnectorSyncState,
} from '@/lib/connectors/sync-state';
import type {
  GmailMessage,
  ParsedEmail,
  GmailAttachment,
  GmailHeader,
  GmailMessagePart,
  GmailSyncState,
  GmailSearchOptions,
  GmailSearchResult,
} from './types';

// Environment variables
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
const IMPERSONATE_EMAIL = process.env.GOOGLE_IMPERSONATE_EMAIL;
const DEBUG = process.env.GMAIL_DEBUG === 'true';

/** Log only when GMAIL_DEBUG=true */
function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log('[Gmail]', ...args);
  }
}

/**
 * Check if Gmail is configured (env vars set and service account file exists)
 */
export function isConfigured(): boolean {
  if (!SERVICE_ACCOUNT_PATH || !IMPERSONATE_EMAIL) {
    return false;
  }
  // Verify service account file exists
  try {
    return existsSync(SERVICE_ACCOUNT_PATH);
  } catch {
    return false;
  }
}

/**
 * Get authenticated Gmail client
 */
async function getGmailClient() {
  if (!SERVICE_ACCOUNT_PATH || !IMPERSONATE_EMAIL) {
    throw new Error(
      'Gmail not configured. Set GOOGLE_SERVICE_ACCOUNT_PATH and GOOGLE_IMPERSONATE_EMAIL'
    );
  }

  const scopes = ['https://www.googleapis.com/auth/gmail.modify'];
  if (process.env.GMAIL_ENABLE_SEND === 'true') {
    scopes.push('https://www.googleapis.com/auth/gmail.send');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes,
    clientOptions: {
      subject: IMPERSONATE_EMAIL, // Impersonate this user
    },
  });

  return google.gmail({ version: 'v1', auth });
}

/**
 * Get sync state from database
 */
export async function getSyncState(): Promise<GmailSyncState> {
  const state = await getConnectorSyncState<GmailSyncState>('sync:gmail');
  return state ?? {};
}

/**
 * Save sync state to database
 */
export async function saveSyncState(state: GmailSyncState): Promise<void> {
  await setConnectorSyncState('sync:gmail', state as Record<string, unknown>);
}

/**
 * Parse email address "Name <email@domain.com>" format
 */
function parseEmailAddress(value: string): { email: string; name?: string } {
  const match = value.match(/^(.+?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2] };
  }
  return { email: value.trim() };
}

/**
 * Get header value by name
 */
function getHeader(headers: GmailHeader[], name: string): string | undefined {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
}

/**
 * Decode base64url encoded content
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Extract body text from message parts
 */
function extractBody(payload: GmailMessage['payload']): { text: string; html?: string } {
  let text = '';
  let html: string | undefined;

  function processPart(part: GmailMessagePart) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text = decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    } else if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  if (payload.body?.data) {
    if (payload.mimeType === 'text/plain') {
      text = decodeBase64Url(payload.body.data);
    } else if (payload.mimeType === 'text/html') {
      html = decodeBase64Url(payload.body.data);
    }
  }

  if (payload.parts) {
    payload.parts.forEach(processPart);
  }

  // If no plain text, strip HTML
  if (!text && html) {
    text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { text, html };
}

/**
 * Extract attachments from message
 */
function extractAttachments(payload: GmailMessage['payload']): GmailAttachment[] {
  const attachments: GmailAttachment[] = [];

  function processPart(part: GmailMessagePart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
      });
    }
    if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  if (payload.parts) {
    payload.parts.forEach(processPart);
  }

  return attachments;
}

/**
 * Parse Gmail API message into our format
 */
function parseMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload.headers;

  const from = parseEmailAddress(getHeader(headers, 'From') || '');
  const toHeader = getHeader(headers, 'To') || '';
  const ccHeader = getHeader(headers, 'Cc') || '';
  const bccHeader = getHeader(headers, 'Bcc') || '';

  const to = toHeader ? toHeader.split(',').map(parseEmailAddress) : [];
  const cc = ccHeader ? ccHeader.split(',').map(parseEmailAddress) : [];
  const bcc = bccHeader ? bccHeader.split(',').map(parseEmailAddress) : [];

  const { text, html } = extractBody(message.payload);
  const attachments = extractAttachments(message.payload);

  // Check for List-Unsubscribe header
  const unsubscribeHeader = getHeader(headers, 'List-Unsubscribe');
  const hasUnsubscribe = !!unsubscribeHeader;
  let unsubscribeUrl: string | undefined;
  if (unsubscribeHeader) {
    const urlMatch = unsubscribeHeader.match(/<(https?:[^>]+)>/);
    if (urlMatch) {
      unsubscribeUrl = urlMatch[1];
    }
  }

  // Check for List-Id header (strong mailing list indicator)
  const hasListId = !!getHeader(headers, 'List-Id');

  return {
    messageId: message.id,
    rfc822MessageId: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id'),
    threadId: message.threadId,
    from,
    to,
    cc,
    bcc,
    subject: getHeader(headers, 'Subject') || '(No Subject)',
    body: text,
    bodyHtml: html,
    snippet: message.snippet,
    receivedAt: new Date(parseInt(message.internalDate)),
    labels: message.labelIds || [],
    attachments,
    hasUnsubscribe,
    hasListId,
    unsubscribeUrl,
  };
}

/**
 * Fetch unarchived emails from Gmail inbox
 */
export async function fetchUnarchived(options?: {
  maxResults?: number;
  pageToken?: string;
}): Promise<{ emails: ParsedEmail[]; nextPageToken?: string }> {
  const gmail = await getGmailClient();

  // Query: in inbox (not archived)
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox',
    maxResults: options?.maxResults || 50,
    pageToken: options?.pageToken,
  });

  const messages = response.data.messages || [];
  const emails: ParsedEmail[] = [];

  // Fetch full message details for each
  for (const msg of messages) {
    if (!msg.id) continue;

    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    if (fullMessage.data) {
      emails.push(parseMessage(fullMessage.data as GmailMessage));
    }
  }

  return {
    emails,
    nextPageToken: response.data.nextPageToken || undefined,
  };
}

/**
 * Search Gmail using Gmail query syntax.
 * Supports: from:, to:, subject:, after:, before:, has:attachment, is:unread, label:, etc.
 */
export async function searchEmails(options: GmailSearchOptions): Promise<GmailSearchResult> {
  if (!options.query?.trim()) {
    throw new Error('Search query is required');
  }

  const gmail = await getGmailClient();
  const maxResults = Math.min(Math.max(options.maxResults || 10, 1), 50);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: options.query,
    maxResults,
    pageToken: options.pageToken,
  });

  const messageRefs = response.data.messages || [];
  const emails: ParsedEmail[] = [];

  for (const ref of messageRefs) {
    if (!ref.id) continue;

    try {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: ref.id,
        format: 'full',
      });

      if (fullMessage.data) {
        emails.push(parseMessage(fullMessage.data as GmailMessage));
      }
    } catch (err: any) {
      // Skip individual message fetch failures (deleted, permission issues)
      debugLog(`Failed to fetch message ${ref.id}:`, err?.message);
    }
  }

  return {
    emails,
    totalEstimate: response.data.resultSizeEstimate || undefined,
    nextPageToken: response.data.nextPageToken || undefined,
  };
}

/**
 * Download an attachment by message ID and attachment ID.
 * Returns the raw attachment data as a Buffer.
 */
export async function getAttachment(
  messageId: string,
  attachmentId: string
): Promise<{ data: Buffer; size: number }> {
  const gmail = await getGmailClient();

  const response = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const base64Data = response.data.data || '';
  const buffer = Buffer.from(base64Data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  return {
    data: buffer,
    size: response.data.size || buffer.length,
  };
}

/**
 * Archive an email in Gmail
 *
 * Gmail archiving = removing the INBOX label. The message stays in "All Mail"
 * and any other labels it has, but disappears from the inbox.
 */
export async function archiveEmail(threadId: string): Promise<void> {
  debugLog(`Archiving thread ${threadId}...`);
  const gmail = await getGmailClient();

  try {
    // Use threads.modify to archive the entire thread (removes INBOX from all messages)
    const result = await gmail.users.threads.modify({
      userId: 'me',
      id: threadId,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });
    debugLog(`Archive result for thread ${threadId}:`, result.status);
  } catch (error: any) {
    console.error(`[Gmail] Archive failed for thread ${threadId}:`, error?.message || error);
    throw error;
  }
}

/**
 * Mark thread as spam in Gmail
 */
export async function markAsSpam(threadId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      removeLabelIds: ['INBOX'],
      addLabelIds: ['SPAM'],
    },
  });
}

/** Strip CRLF and null bytes from header values to prevent header injection */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]/g, '');
}

interface EmailOptions {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
}

/** Build an RFC 2822 message and return it as a base64url-encoded string */
function buildRawMessage(options: EmailOptions): string {
  const headers = [
    `To: ${sanitizeHeader(options.to)}`,
    options.cc ? `Cc: ${sanitizeHeader(options.cc)}` : '',
    options.bcc ? `Bcc: ${sanitizeHeader(options.bcc)}` : '',
    `Subject: ${sanitizeHeader(options.subject)}`,
    options.inReplyTo ? `In-Reply-To: ${sanitizeHeader(options.inReplyTo)}` : '',
    options.inReplyTo ? `References: ${sanitizeHeader(options.inReplyTo)}` : '',
    'Content-Type: text/plain; charset=utf-8',
  ].filter(Boolean).join('\r\n');

  const message = headers + '\r\n\r\n' + options.body;
  return Buffer.from(message).toString('base64url');
}

/**
 * Create a draft reply
 */
export async function createDraft(options: EmailOptions): Promise<string> {
  const gmail = await getGmailClient();

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        threadId: options.threadId,
        raw: buildRawMessage(options),
      },
    },
  });

  return response.data.id || '';
}

/**
 * Send email (only if GMAIL_ENABLE_SEND=true)
 */
export async function sendEmail(options: EmailOptions): Promise<string> {
  if (process.env.GMAIL_ENABLE_SEND !== 'true') {
    throw new Error('GMAIL_ENABLE_SEND is not enabled. Use createDraft() instead.');
  }

  const gmail = await getGmailClient();

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      threadId: options.threadId,
      raw: buildRawMessage(options),
    },
  });

  return response.data.id || '';
}

/**
 * Get thread with all messages
 */
export async function getThread(threadId: string): Promise<ParsedEmail[]> {
  const gmail = await getGmailClient();

  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = response.data.messages || [];
  return messages.map(msg => parseMessage(msg as GmailMessage));
}

// Module-level label cache (labels rarely change)
const labelCache: Map<string, string> = new Map();
const LABEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let labelCacheTime = 0;

/**
 * Add a label to a Gmail message by label name.
 * Looks up the label ID from a cached list, then applies it.
 * Auto-creates the label if it doesn't exist.
 */
export async function addLabel(messageId: string, labelName: string): Promise<void> {
  const gmail = await getGmailClient();

  let labelId = labelCache.get(labelName);

  // Refresh cache if stale or miss
  if (!labelId || Date.now() - labelCacheTime > LABEL_CACHE_TTL) {
    const labels = await gmail.users.labels.list({ userId: 'me' });
    labelCache.clear();
    labelCacheTime = Date.now();
    for (const l of labels.data.labels || []) {
      if (l.name && l.id) labelCache.set(l.name, l.id);
    }
    labelId = labelCache.get(labelName);
  }

  // Auto-create the label if it doesn't exist
  if (!labelId) {
    const created = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    labelId = created.data.id!;
    labelCache.set(labelName, labelId);
  }

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}

/**
 * Get Gravatar URL for email
 */
export function getGravatarUrl(email: string, size: number = 80): string {
  const hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`;
}
