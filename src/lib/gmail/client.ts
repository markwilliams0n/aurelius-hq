/**
 * Gmail API Client
 *
 * Uses Service Account with domain-wide delegation for Workspace accounts.
 */

import { google } from 'googleapis';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  GmailMessage,
  ParsedEmail,
  GmailAttachment,
  GmailHeader,
  GmailMessagePart,
  GmailSyncState
} from './types';

const SYNC_STATE_PATH = path.join(process.cwd(), '.gmail-sync-state.json');

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

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      // gmail.send added when GMAIL_ENABLE_SEND=true
    ],
    clientOptions: {
      subject: IMPERSONATE_EMAIL, // Impersonate this user
    },
  });

  return google.gmail({ version: 'v1', auth });
}

/**
 * Get sync state
 */
export async function getSyncState(): Promise<GmailSyncState> {
  try {
    const content = await fs.readFile(SYNC_STATE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save sync state
 */
export async function saveSyncState(state: GmailSyncState): Promise<void> {
  await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
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

  return {
    messageId: message.id,
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
 * Archive an email in Gmail
 *
 * Gmail archiving = removing the INBOX label. The message stays in "All Mail"
 * and any other labels it has, but disappears from the inbox.
 */
export async function archiveEmail(messageId: string): Promise<void> {
  debugLog(`Archiving message ${messageId}...`);
  const gmail = await getGmailClient();

  try {
    // First, get the current message to see its labels
    const before = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'minimal',
    });
    debugLog(`Before archive - labels:`, before.data.labelIds);

    // Check if already archived
    if (!before.data.labelIds?.includes('INBOX')) {
      debugLog(`Message ${messageId} already archived (no INBOX label)`);
      return;
    }

    const result = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });
    debugLog(`Archive result for ${messageId}:`, result.status);

    // Verify the archive took effect
    if (DEBUG) {
      const verify = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'minimal',
      });
      if (verify.data.labelIds?.includes('INBOX')) {
        console.error(`[Gmail] WARNING: INBOX label still present after archive!`);
      } else {
        debugLog(`Verified: INBOX label removed successfully`);
      }
    }
  } catch (error: any) {
    console.error(`[Gmail] Archive failed for ${messageId}:`, error?.message || error);
    throw error;
  }
}

/**
 * Mark email as spam in Gmail
 */
export async function markAsSpam(messageId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
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

/**
 * Create a draft reply
 */
export async function createDraft(options: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
}): Promise<string> {
  const gmail = await getGmailClient();

  const message = [
    `To: ${sanitizeHeader(options.to)}`,
    options.cc ? `Cc: ${sanitizeHeader(options.cc)}` : '',
    options.bcc ? `Bcc: ${sanitizeHeader(options.bcc)}` : '',
    `Subject: ${sanitizeHeader(options.subject)}`,
    options.inReplyTo ? `In-Reply-To: ${sanitizeHeader(options.inReplyTo)}` : '',
    options.inReplyTo ? `References: ${sanitizeHeader(options.inReplyTo)}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body,
  ].filter(Boolean).join('\r\n');

  const encodedMessage = Buffer.from(message).toString('base64url');

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        threadId: options.threadId,
        raw: encodedMessage,
      },
    },
  });

  return response.data.id || '';
}

/**
 * Send email (only if GMAIL_ENABLE_SEND=true)
 */
export async function sendEmail(options: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
}): Promise<string> {
  if (process.env.GMAIL_ENABLE_SEND !== 'true') {
    // Fall back to draft
    console.log('[Gmail] GMAIL_ENABLE_SEND not true, creating draft instead');
    return createDraft(options);
  }

  const gmail = await getGmailClient();

  const message = [
    `To: ${sanitizeHeader(options.to)}`,
    options.cc ? `Cc: ${sanitizeHeader(options.cc)}` : '',
    options.bcc ? `Bcc: ${sanitizeHeader(options.bcc)}` : '',
    `Subject: ${sanitizeHeader(options.subject)}`,
    options.inReplyTo ? `In-Reply-To: ${sanitizeHeader(options.inReplyTo)}` : '',
    options.inReplyTo ? `References: ${sanitizeHeader(options.inReplyTo)}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body,
  ].filter(Boolean).join('\r\n');

  const encodedMessage = Buffer.from(message).toString('base64url');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      threadId: options.threadId,
      raw: encodedMessage,
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

/**
 * Get Gravatar URL for email
 */
export function getGravatarUrl(email: string, size: number = 80): string {
  const hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`;
}
