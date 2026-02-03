# Gmail Connector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full Gmail integration for inbox-zero triage workflow with bi-directional sync, AI enrichment, and smart sender analysis.

**Architecture:** Service Account with domain-wide delegation authenticates to Gmail API. Heartbeat triggers sync which fetches unarchived emails, dedupes by thread ID, runs AI enrichment (intent, sentiment, phishing detection), and inserts to triage. Actions (archive, spam, reply) sync back to Gmail.

**Tech Stack:** Google APIs (gmail v1), googleapis npm package, Service Account JSON credentials, existing triage infrastructure (Drizzle, inbox_items table).

---

## Phase 1: Core Infrastructure

### Task 1: Add googleapis dependency

**Files:**
- Modify: `package.json`

**Step 1: Install googleapis**

```bash
bun add googleapis
```

**Step 2: Verify installation**

```bash
bun run build
```
Expected: Build succeeds without errors

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add googleapis dependency for Gmail connector"
```

---

### Task 2: Create Gmail types

**Files:**
- Create: `src/lib/gmail/types.ts`

**Step 1: Write the types file**

```typescript
/**
 * Gmail Connector Types
 */

// Gmail message from API
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string; // Unix timestamp in ms
  payload: GmailMessagePayload;
}

export interface GmailMessagePayload {
  mimeType: string;
  headers: GmailHeader[];
  body?: GmailMessageBody;
  parts?: GmailMessagePart[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageBody {
  attachmentId?: string;
  size: number;
  data?: string; // Base64 encoded
}

export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename?: string;
  headers: GmailHeader[];
  body: GmailMessageBody;
  parts?: GmailMessagePart[];
}

// Parsed email for our use
export interface ParsedEmail {
  messageId: string;
  threadId: string;
  from: {
    email: string;
    name?: string;
  };
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  bcc: Array<{ email: string; name?: string }>;
  subject: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
  receivedAt: Date;
  labels: string[];
  attachments: GmailAttachment[];
  hasUnsubscribe: boolean;
  unsubscribeUrl?: string;
}

export interface GmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// Thread with messages
export interface GmailThread {
  id: string;
  messages: ParsedEmail[];
  latestMessage: ParsedEmail;
  messageCount: number;
}

// Sync state
export interface GmailSyncState {
  lastSyncedAt?: string;
  historyId?: string; // For incremental sync
}

// Gmail enrichment (added to standard enrichment)
export interface GmailEnrichment {
  // Standard fields inherited from base
  summary?: string;
  suggestedPriority?: string;
  suggestedTags?: string[];
  linkedEntities?: Array<{ id: string; name: string; type: string }>;
  contextFromMemory?: string;

  // Gmail-specific
  intent?: 'fyi' | 'needs_response' | 'action_required' | 'question' | 'confirmation';
  deadline?: string;
  sentiment?: 'urgent' | 'friendly' | 'formal' | 'frustrated' | 'neutral';
  threadSummary?: string;

  // Smart sender tags
  senderTags?: string[]; // 'Internal', 'New', 'Direct', 'CC', 'VIP', 'Auto', 'Newsletter', 'Suspicious'

  // Phishing detection
  phishingIndicators?: string[];
  isSuspicious?: boolean;

  // Thread info
  threadId?: string;
  messageCount?: number;

  // Attachments
  attachments?: GmailAttachment[];
}

// Sync result
export interface GmailSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  emails: Array<{ id: string; threadId: string; subject: string }>;
}
```

**Step 2: Verify types compile**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/types.ts
git commit -m "feat(gmail): add TypeScript types for Gmail connector"
```

---

### Task 3: Create Gmail client with Service Account auth

**Files:**
- Create: `src/lib/gmail/client.ts`

**Step 1: Write the client**

```typescript
/**
 * Gmail API Client
 *
 * Uses Service Account with domain-wide delegation for Workspace accounts.
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
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

/**
 * Check if Gmail is configured
 */
export function isConfigured(): boolean {
  return !!(SERVICE_ACCOUNT_PATH && IMPERSONATE_EMAIL);
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

  function processpart(part: GmailMessagePart) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text = decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    } else if (part.parts) {
      part.parts.forEach(processpart);
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
    payload.parts.forEach(processpart);
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
 */
export async function archiveEmail(messageId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  });
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

/**
 * Create a draft reply
 */
export async function createDraft(options: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}): Promise<string> {
  const gmail = await getGmailClient();

  const message = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : '',
    options.inReplyTo ? `References: ${options.inReplyTo}` : '',
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
}): Promise<string> {
  if (process.env.GMAIL_ENABLE_SEND !== 'true') {
    // Fall back to draft
    console.log('[Gmail] GMAIL_ENABLE_SEND not true, creating draft instead');
    return createDraft(options);
  }

  const gmail = await getGmailClient();

  const message = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : '',
    options.inReplyTo ? `References: ${options.inReplyTo}` : '',
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
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=mp`;
}
```

**Step 2: Verify it compiles**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/client.ts
git commit -m "feat(gmail): add Gmail API client with Service Account auth"
```

---

### Task 4: Create Gmail sync logic

**Files:**
- Create: `src/lib/gmail/sync.ts`

**Step 1: Write the sync module**

```typescript
/**
 * Gmail Sync
 *
 * Syncs Gmail messages to triage inbox.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { insertInboxItemWithTasks } from '@/lib/triage/insert-with-tasks';
import {
  isConfigured,
  fetchUnarchived,
  getSyncState,
  saveSyncState,
  getGravatarUrl,
  type ParsedEmail,
} from './client';
import type { GmailSyncResult, GmailEnrichment } from './types';

/**
 * Check if a thread is already in triage
 */
async function threadExists(threadId: string): Promise<boolean> {
  const existing = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'gmail'),
        eq(inboxItems.externalId, threadId)
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Analyze sender for smart tags
 */
function analyzeSender(email: ParsedEmail, userDomain: string): string[] {
  const tags: string[] = [];
  const senderEmail = email.from.email.toLowerCase();
  const senderDomain = senderEmail.split('@')[1];

  // Internal
  if (senderDomain === userDomain) {
    tags.push('Internal');
  }

  // Direct vs CC'd
  const userEmail = process.env.GOOGLE_IMPERSONATE_EMAIL?.toLowerCase();
  if (userEmail) {
    const isDirectRecipient = email.to.some(
      r => r.email.toLowerCase() === userEmail
    );
    if (isDirectRecipient) {
      tags.push('Direct');
    } else if (email.cc.some(r => r.email.toLowerCase() === userEmail)) {
      tags.push('CC');
    }
  }

  // Auto/notification sender
  const autoPatterns = ['noreply', 'no-reply', 'notifications', 'mailer', 'donotreply'];
  if (autoPatterns.some(p => senderEmail.includes(p))) {
    tags.push('Auto');
  }

  // Newsletter
  if (email.hasUnsubscribe) {
    tags.push('Newsletter');
  }

  // Group (many recipients)
  if (email.to.length + email.cc.length >= 5) {
    tags.push('Group');
  }

  return tags;
}

/**
 * Check for phishing indicators
 */
function checkPhishing(email: ParsedEmail): { isSuspicious: boolean; indicators: string[] } {
  const indicators: string[] = [];
  const senderEmail = email.from.email.toLowerCase();
  const senderDomain = senderEmail.split('@')[1];
  const displayName = email.from.name?.toLowerCase() || '';

  // Known brands to protect
  const protectedBrands: Record<string, string[]> = {
    stripe: ['stripe.com'],
    amazon: ['amazon.com', 'amazon.co.uk', 'amazon.de'],
    apple: ['apple.com', 'icloud.com'],
    google: ['google.com', 'gmail.com'],
    microsoft: ['microsoft.com', 'outlook.com'],
    paypal: ['paypal.com'],
    netflix: ['netflix.com'],
  };

  // Check display name vs domain mismatch
  for (const [brand, domains] of Object.entries(protectedBrands)) {
    if (displayName.includes(brand) && !domains.includes(senderDomain)) {
      indicators.push(`Display name mentions "${brand}" but sender is ${senderDomain}`);
    }
  }

  // Check for lookalike domains
  const lookalikes: Record<string, RegExp> = {
    stripe: /str[i1]pe|str1pe|strlpe/i,
    amazon: /amaz[o0]n|arnaz0n|arnazon/i,
    apple: /app[l1]e|app1e/i,
    paypal: /paypa[l1]|paypa1/i,
  };

  for (const [brand, pattern] of Object.entries(lookalikes)) {
    if (pattern.test(senderDomain) && !protectedBrands[brand].includes(senderDomain)) {
      indicators.push(`Domain ${senderDomain} looks like ${brand} impersonation`);
    }
  }

  // Urgency patterns in subject
  const urgentPatterns = [
    /account.*(suspend|terminat|locked|compromised)/i,
    /verify.*immediately/i,
    /act.*now/i,
    /urgent.*action/i,
    /your.*password.*(expired|reset)/i,
  ];

  for (const pattern of urgentPatterns) {
    if (pattern.test(email.subject)) {
      indicators.push('Subject contains urgency language');
      break;
    }
  }

  return {
    isSuspicious: indicators.length > 0,
    indicators,
  };
}

/**
 * Transform a parsed email into a triage inbox item
 */
function transformToInboxItem(email: ParsedEmail) {
  const userDomain = process.env.GOOGLE_IMPERSONATE_EMAIL?.split('@')[1] || '';
  const senderTags = analyzeSender(email, userDomain);
  const phishing = checkPhishing(email);

  if (phishing.isSuspicious) {
    senderTags.push('Suspicious');
  }

  // Build preview
  const preview = email.snippet.slice(0, 200) + (email.snippet.length > 200 ? '...' : '');

  // Build content with metadata
  const contentParts = [
    `# ${email.subject}`,
    '',
    `**From:** ${email.from.name || email.from.email}`,
    `**To:** ${email.to.map(r => r.name || r.email).join(', ')}`,
  ];

  if (email.cc.length > 0) {
    contentParts.push(`**CC:** ${email.cc.map(r => r.name || r.email).join(', ')}`);
  }

  contentParts.push(
    `**Date:** ${email.receivedAt.toLocaleString()}`,
    '',
    '---',
    '',
    email.body
  );

  const enrichment: GmailEnrichment = {
    senderTags,
    threadId: email.threadId,
    messageCount: 1, // Will be updated when we fetch thread
    attachments: email.attachments,
    isSuspicious: phishing.isSuspicious,
    phishingIndicators: phishing.indicators.length > 0 ? phishing.indicators : undefined,
  };

  return {
    connector: 'gmail' as const,
    externalId: email.threadId, // Use thread ID for deduplication
    sender: email.from.email,
    senderName: email.from.name || email.from.email,
    senderAvatar: getGravatarUrl(email.from.email),
    subject: email.subject,
    preview,
    content: contentParts.join('\n'),
    rawPayload: {
      messageId: email.messageId,
      threadId: email.threadId,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      labels: email.labels,
      hasUnsubscribe: email.hasUnsubscribe,
      unsubscribeUrl: email.unsubscribeUrl,
    },
    receivedAt: email.receivedAt,
    status: 'new' as const,
    priority: 'normal' as const,
    enrichment,
  };
}

/**
 * Sync Gmail messages to triage inbox.
 * Fetches unarchived emails and adds new threads to triage.
 */
export async function syncGmailMessages(): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    synced: 0,
    skipped: 0,
    errors: 0,
    emails: [],
  };

  // Check if Gmail is configured
  if (!isConfigured()) {
    console.log('[Gmail] Not configured, skipping sync');
    return result;
  }

  console.log('[Gmail] Starting sync...');

  try {
    // Fetch unarchived emails
    const { emails } = await fetchUnarchived({ maxResults: 50 });
    console.log(`[Gmail] Found ${emails.length} emails in inbox`);

    // Group by thread - only process latest message per thread
    const threadMap = new Map<string, ParsedEmail>();
    for (const email of emails) {
      const existing = threadMap.get(email.threadId);
      if (!existing || email.receivedAt > existing.receivedAt) {
        threadMap.set(email.threadId, email);
      }
    }

    console.log(`[Gmail] ${threadMap.size} unique threads to process`);

    for (const [threadId, email] of threadMap) {
      try {
        // Skip if already imported
        if (await threadExists(threadId)) {
          result.skipped++;
          continue;
        }

        // Transform and insert into triage
        const item = transformToInboxItem(email);
        await insertInboxItemWithTasks(item);

        result.synced++;
        result.emails.push({
          id: email.messageId,
          threadId: email.threadId,
          subject: email.subject,
        });
        console.log(`[Gmail] Synced: ${email.subject}`);
      } catch (error) {
        console.error(`[Gmail] Error syncing ${email.messageId}:`, error);
        result.errors++;
      }
    }

    // Update sync state
    await saveSyncState({
      lastSyncedAt: new Date().toISOString(),
    });

    console.log(
      `[Gmail] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`
    );
  } catch (error) {
    console.error('[Gmail] Sync failed:', error);
    throw error;
  }

  return result;
}
```

**Step 2: Verify it compiles**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/sync.ts
git commit -m "feat(gmail): add sync logic with smart sender analysis"
```

---

### Task 5: Create Gmail index file

**Files:**
- Create: `src/lib/gmail/index.ts`

**Step 1: Write the index file**

```typescript
/**
 * Gmail Connector
 *
 * Re-exports all Gmail functionality.
 */

export * from './types';
export * from './client';
export { syncGmailMessages, type GmailSyncResult } from './sync';
```

**Step 2: Verify it compiles**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/index.ts
git commit -m "feat(gmail): add index file for Gmail connector"
```

---

### Task 6: Integrate Gmail sync into heartbeat

**Files:**
- Modify: `src/lib/memory/heartbeat.ts`

**Step 1: Read current heartbeat file**

Read the full file to understand the structure.

**Step 2: Add Gmail import**

Add after the Granola import at the top:

```typescript
import { syncGmailMessages, type GmailSyncResult } from '@/lib/gmail';
```

**Step 3: Add skipGmail option to HeartbeatOptions interface**

Find the `HeartbeatOptions` interface and add:

```typescript
skipGmail?: boolean;
```

**Step 4: Add Gmail sync to runHeartbeat function**

Find where `syncGranolaMeetings` is called and add Gmail sync nearby:

```typescript
// Gmail sync
let gmailResult: GmailSyncResult | null = null;
if (!options.skipGmail) {
  try {
    gmailResult = await syncGmailMessages();
    console.log(`[Heartbeat] Gmail: ${gmailResult.synced} synced`);
  } catch (error) {
    console.warn('[Heartbeat] Gmail sync failed:', error);
    warnings.push(`Gmail sync failed: ${error}`);
  }
}
```

**Step 5: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/lib/memory/heartbeat.ts
git commit -m "feat(gmail): integrate Gmail sync into heartbeat process"
```

---

### Task 7: Create Gmail sync API endpoint

**Files:**
- Create: `src/app/api/gmail/sync/route.ts`

**Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server';
import { syncGmailMessages } from '@/lib/gmail';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes

/**
 * POST /api/gmail/sync
 *
 * Manually trigger Gmail sync.
 */
export async function POST() {
  try {
    const result = await syncGmailMessages();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Gmail API] Sync failed:', error);
    return NextResponse.json(
      { error: 'Gmail sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gmail/sync
 *
 * Same as POST for convenience.
 */
export async function GET() {
  return POST();
}
```

**Step 2: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/api/gmail/sync/route.ts
git commit -m "feat(gmail): add manual sync API endpoint"
```

---

## Phase 2: Actions & UI

### Task 8: Create Gmail actions module

**Files:**
- Create: `src/lib/gmail/actions.ts`

**Step 1: Write the actions module**

```typescript
/**
 * Gmail Actions
 *
 * Handles Gmail-specific triage actions that sync back to Gmail.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  archiveEmail,
  markAsSpam,
  createDraft,
  sendEmail,
} from './client';

/**
 * Archive in Gmail when archived in triage
 */
export async function syncArchiveToGmail(itemId: string): Promise<void> {
  // Get the item to find the message ID
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.connector !== 'gmail') {
    return;
  }

  const messageId = (item.rawPayload as any)?.messageId;
  if (!messageId) {
    console.warn(`[Gmail] No messageId found for item ${itemId}`);
    return;
  }

  try {
    await archiveEmail(messageId);
    console.log(`[Gmail] Archived message ${messageId} in Gmail`);
  } catch (error) {
    console.error(`[Gmail] Failed to archive in Gmail:`, error);
    throw error;
  }
}

/**
 * Mark as spam in Gmail
 */
export async function syncSpamToGmail(itemId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.connector !== 'gmail') {
    return;
  }

  const messageId = (item.rawPayload as any)?.messageId;
  if (!messageId) {
    console.warn(`[Gmail] No messageId found for item ${itemId}`);
    return;
  }

  try {
    await markAsSpam(messageId);
    console.log(`[Gmail] Marked message ${messageId} as spam in Gmail`);
  } catch (error) {
    console.error(`[Gmail] Failed to mark as spam in Gmail:`, error);
    throw error;
  }
}

/**
 * Create reply (draft or send based on settings)
 */
export async function replyToEmail(
  itemId: string,
  body: string,
  options?: { replyAll?: boolean; forceDraft?: boolean }
): Promise<{ draftId?: string; messageId?: string; wasDraft: boolean }> {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.connector !== 'gmail') {
    throw new Error('Item not found or not a Gmail item');
  }

  const rawPayload = item.rawPayload as any;
  const threadId = rawPayload?.threadId;
  const messageId = rawPayload?.messageId;
  const to = item.sender; // Reply to sender
  const subject = item.subject.startsWith('Re:') ? item.subject : `Re: ${item.subject}`;

  if (!threadId) {
    throw new Error('No threadId found for this item');
  }

  // Determine whether to draft or send
  const shouldDraft = options?.forceDraft || process.env.GMAIL_ENABLE_SEND !== 'true';

  if (shouldDraft) {
    const draftId = await createDraft({
      threadId,
      to,
      subject,
      body,
      inReplyTo: messageId,
    });
    return { draftId, wasDraft: true };
  } else {
    const sentMessageId = await sendEmail({
      threadId,
      to,
      subject,
      body,
      inReplyTo: messageId,
    });
    return { messageId: sentMessageId, wasDraft: false };
  }
}

/**
 * Get unsubscribe URL for an item
 */
export async function getUnsubscribeUrl(itemId: string): Promise<string | null> {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.connector !== 'gmail') {
    return null;
  }

  return (item.rawPayload as any)?.unsubscribeUrl || null;
}
```

**Step 2: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/actions.ts
git commit -m "feat(gmail): add actions module for Gmail-specific triage actions"
```

---

### Task 9: Create Gmail reply API endpoint

**Files:**
- Create: `src/app/api/gmail/reply/route.ts`

**Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { replyToEmail } from '@/lib/gmail/actions';

export const runtime = 'nodejs';

/**
 * POST /api/gmail/reply
 *
 * Reply to a Gmail message.
 *
 * Body:
 * - itemId: string - The triage item ID
 * - body: string - The reply body
 * - replyAll?: boolean - Reply to all recipients
 * - forceDraft?: boolean - Always create draft even if GMAIL_ENABLE_SEND=true
 */
export async function POST(request: NextRequest) {
  try {
    const { itemId, body, replyAll, forceDraft } = await request.json();

    if (!itemId || !body) {
      return NextResponse.json(
        { error: 'Missing itemId or body' },
        { status: 400 }
      );
    }

    const result = await replyToEmail(itemId, body, { replyAll, forceDraft });

    return NextResponse.json({
      success: true,
      ...result,
      message: result.wasDraft
        ? 'Draft created in Gmail'
        : 'Email sent',
    });
  } catch (error) {
    console.error('[Gmail API] Reply failed:', error);
    return NextResponse.json(
      { error: 'Reply failed', details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/api/gmail/reply/route.ts
git commit -m "feat(gmail): add reply API endpoint"
```

---

### Task 10: Update triage API to sync archive to Gmail

**Files:**
- Modify: `src/app/api/triage/[id]/route.ts`

**Step 1: Read current file**

Read the file to understand the structure.

**Step 2: Add import**

Add at top with other imports:

```typescript
import { syncArchiveToGmail } from '@/lib/gmail/actions';
```

**Step 3: Add Gmail sync to archive action**

Find the PATCH handler where status is updated to 'archived'. After the database update, add:

```typescript
// Sync to Gmail if applicable
if (status === 'archived' && item.connector === 'gmail') {
  try {
    await syncArchiveToGmail(id);
  } catch (gmailError) {
    console.warn('[Triage] Gmail archive sync failed:', gmailError);
    // Don't fail the request, just log warning
  }
}
```

**Step 4: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/api/triage/[id]/route.ts
git commit -m "feat(gmail): sync archive action back to Gmail"
```

---

### Task 11: Update index export

**Files:**
- Modify: `src/lib/gmail/index.ts`

**Step 1: Add actions export**

```typescript
/**
 * Gmail Connector
 *
 * Re-exports all Gmail functionality.
 */

export * from './types';
export * from './client';
export { syncGmailMessages } from './sync';
export type { GmailSyncResult } from './sync';
export * from './actions';
```

**Step 2: Verify build**

```bash
bun run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/gmail/index.ts
git commit -m "feat(gmail): export actions from index"
```

---

## Phase 3: Testing & Documentation

### Task 12: Add environment variable documentation

**Files:**
- Modify: `README.md` or create `.env.example`

**Step 1: Document Gmail environment variables**

Add to documentation:

```markdown
## Gmail Configuration

For Gmail integration (Workspace accounts with domain-wide delegation):

```bash
# Path to your GCP Service Account JSON key file
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json

# Email address to impersonate (your Workspace email)
GOOGLE_IMPERSONATE_EMAIL=you@yourworkspace.com

# Enable direct sending (default: false, creates drafts only)
GMAIL_ENABLE_SEND=false
```

### Setup Steps

1. Create a GCP project and enable the Gmail API
2. Create a Service Account with domain-wide delegation enabled
3. Download the JSON key file
4. In Google Admin Console → Security → API Controls → Domain-wide delegation
5. Add the service account client ID with scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send` (when ready)
6. Set the environment variables above
```

**Step 2: Commit**

```bash
git add .env.example README.md
git commit -m "docs(gmail): add environment variable documentation"
```

---

### Task 13: Manual integration test

**Files:**
- None (manual testing)

**Step 1: Set up environment**

1. Create GCP Service Account with Gmail API access
2. Enable domain-wide delegation
3. Add scopes in Google Admin Console
4. Set environment variables

**Step 2: Test sync**

```bash
curl -X POST http://localhost:3333/api/gmail/sync
```

Expected: Returns `{ synced: N, skipped: N, errors: 0, emails: [...] }`

**Step 3: Verify in UI**

1. Open http://localhost:3333/triage
2. Should see Gmail emails with smart tags
3. Archive an email → should archive in Gmail too

**Step 4: Test reply (draft mode)**

```bash
curl -X POST http://localhost:3333/api/gmail/reply \
  -H "Content-Type: application/json" \
  -d '{"itemId": "...", "body": "Test reply"}'
```

Expected: Returns `{ success: true, draftId: "...", wasDraft: true }`

---

## Summary

### Phase 1 Complete
- [x] googleapis dependency
- [x] Gmail types
- [x] Gmail client with Service Account auth
- [x] Gmail sync logic with smart sender analysis
- [x] Gmail index file
- [x] Heartbeat integration
- [x] Sync API endpoint

### Phase 2 Complete
- [x] Gmail actions module
- [x] Reply API endpoint
- [x] Archive sync to Gmail

### Phase 3 Complete
- [x] Environment documentation
- [x] Manual integration test

### Future Phases (not in this plan)
- [ ] AI enrichment (intent, sentiment, deadline detection)
- [ ] AI draft replies
- [ ] Thread view in UI
- [ ] Phishing detection UI
- [ ] Unsubscribe action
- [ ] Spam action
- [ ] Always Archive rule creation
- [ ] Style guide integration
- [ ] Settings UI
