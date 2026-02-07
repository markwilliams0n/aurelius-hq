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
import { chat } from '@/lib/ai/client';
import {
  isConfigured,
  fetchUnarchived,
  getSyncState,
  saveSyncState,
  getGravatarUrl,
} from './client';
import type { ParsedEmail, GmailSyncResult, GmailEnrichment } from './types';

/** Small delay to avoid rate limiting */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate a brief summary of an email
 */
async function summarizeEmail(email: ParsedEmail): Promise<string | undefined> {
  try {
    const prompt = `Summarize this email in 1-2 sentences. Be concise and focus on the key action or information.

From: ${email.from.name || email.from.email}
Subject: ${email.subject}

${email.body.slice(0, 2000)}`;

    const summary = await chat(prompt, "You are a helpful assistant that summarizes emails very concisely. Output only the summary, no preamble.");
    return summary.trim();
  } catch (error) {
    console.error('[Gmail] Failed to summarize email:', error);
    return undefined;
  }
}

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
function transformToInboxItem(email: ParsedEmail, summary?: string) {
  const userDomain = process.env.GOOGLE_IMPERSONATE_EMAIL?.split('@')[1] || '';
  const senderTags = analyzeSender(email, userDomain);
  const phishing = checkPhishing(email);

  if (phishing.isSuspicious) {
    senderTags.push('Suspicious');
  }

  // Build preview - use summary if available, otherwise snippet
  const preview = summary || (email.snippet.slice(0, 200) + (email.snippet.length > 200 ? '...' : ''));

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

  // Extract recipients with internal filter
  const allRecipients = [...email.to, ...email.cc];
  const internalRecipients = allRecipients.filter(r =>
    r.email.toLowerCase().endsWith('@rostr.cc')
  );

  const enrichment: GmailEnrichment = {
    senderTags,
    threadId: email.threadId,
    messageCount: 1, // Will be updated when we fetch thread
    attachments: email.attachments,
    isSuspicious: phishing.isSuspicious,
    phishingIndicators: phishing.indicators.length > 0 ? phishing.indicators : undefined,
    summary, // Add AI summary to enrichment
    recipients: {
      to: email.to,
      cc: email.cc,
      internal: internalRecipients,
    },
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
      rfc822MessageId: email.rfc822MessageId,
      threadId: email.threadId,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      labels: email.labels,
      hasUnsubscribe: email.hasUnsubscribe,
      unsubscribeUrl: email.unsubscribeUrl,
      bodyHtml: email.bodyHtml, // Store HTML for rich rendering
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
    archived: 0,
    emails: [],
  };

  // Check if Gmail is configured
  if (!isConfigured()) {
    console.log('[Gmail] Not configured, skipping sync');
    return result;
  }

  console.log('[Gmail] Starting sync...');

  try {
    // Fetch all unarchived emails with pagination
    const allEmails: ParsedEmail[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 10; // Safety limit: 10 pages * 100 = 1000 emails max

    do {
      const { emails, nextPageToken } = await fetchUnarchived({
        maxResults: 100,
        pageToken
      });
      allEmails.push(...emails);
      pageToken = nextPageToken;
      pageCount++;
      console.log(`[Gmail] Fetched page ${pageCount}: ${emails.length} emails (total: ${allEmails.length})`);

      // Rate limiting: small delay between pages to avoid hitting Gmail API quotas
      if (pageToken) {
        await delay(100);
      }
    } while (pageToken && pageCount < maxPages);

    console.log(`[Gmail] Found ${allEmails.length} emails in inbox`);

    // Group by thread - only process latest message per thread
    const threadMap = new Map<string, ParsedEmail>();
    for (const email of allEmails) {
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

        // Generate AI summary for the email
        console.log(`[Gmail] Summarizing: ${email.subject}`);
        const summary = await summarizeEmail(email);

        // Transform and insert into triage
        const item = transformToInboxItem(email, summary);
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

    // Reconcile: auto-archive triage items whose threads are no longer in Gmail inbox
    try {
      const gmailThreadIds = new Set(threadMap.keys());
      const activeTriageItems = await db
        .select({ id: inboxItems.id, externalId: inboxItems.externalId, subject: inboxItems.subject })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.connector, 'gmail'),
            eq(inboxItems.status, 'new')
          )
        );

      for (const item of activeTriageItems) {
        if (item.externalId && !gmailThreadIds.has(item.externalId)) {
          await db
            .update(inboxItems)
            .set({ status: 'archived' })
            .where(eq(inboxItems.id, item.id));
          result.archived++;
          console.log(`[Gmail] Auto-archived (no longer in inbox): ${item.subject}`);
        }
      }
    } catch (error) {
      console.error('[Gmail] Reconciliation failed:', error);
      // Non-fatal — don't fail the whole sync
    }

    // Update sync state
    await saveSyncState({
      lastSyncedAt: new Date().toISOString(),
    });

    console.log(
      `[Gmail] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.archived} archived, ${result.errors} errors`
    );
  } catch (error) {
    console.error('[Gmail] Sync failed:', error);
    throw error;
  }

  return result;
}
