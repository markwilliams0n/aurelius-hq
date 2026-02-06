/**
 * Gmail Actions
 *
 * Handles Gmail-specific triage actions that sync back to Gmail.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, or } from 'drizzle-orm';
import {
  archiveEmail,
  markAsSpam,
  createDraft,
  sendEmail,
} from './client';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find item by UUID id or externalId (same pattern as triage API) */
async function findItem(itemId: string) {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(
      uuidRegex.test(itemId)
        ? or(eq(inboxItems.id, itemId), eq(inboxItems.externalId, itemId))
        : eq(inboxItems.externalId, itemId)
    )
    .limit(1);
  return item;
}

/**
 * Archive in Gmail when archived in triage
 */
export async function syncArchiveToGmail(itemId: string): Promise<void> {
  const item = await findItem(itemId);

  if (!item || item.connector !== 'gmail') {
    return;
  }

  const messageId = (item.rawPayload as Record<string, unknown>)?.messageId as string | undefined;
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
  const item = await findItem(itemId);

  if (!item || item.connector !== 'gmail') {
    return;
  }

  const messageId = (item.rawPayload as Record<string, unknown>)?.messageId as string | undefined;
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
  options?: {
    replyAll?: boolean;
    forceDraft?: boolean;
    to?: string;
    cc?: string;
    bcc?: string;
  }
): Promise<{ draftId?: string; messageId?: string; wasDraft: boolean }> {
  const item = await findItem(itemId);

  if (!item || item.connector !== 'gmail') {
    throw new Error('Item not found or not a Gmail item');
  }

  const rawPayload = item.rawPayload as Record<string, unknown>;
  const threadId = rawPayload?.threadId as string | undefined;
  const rfc822MessageId = rawPayload?.rfc822MessageId as string | undefined;
  const to = options?.to || item.sender;
  const cc = options?.cc || undefined;
  const bcc = options?.bcc || undefined;
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
      inReplyTo: rfc822MessageId,
      cc,
      bcc,
    });
    return { draftId, wasDraft: true };
  } else {
    const sentMessageId = await sendEmail({
      threadId,
      to,
      subject,
      body,
      inReplyTo: rfc822MessageId,
      cc,
      bcc,
    });
    return { messageId: sentMessageId, wasDraft: false };
  }
}

/**
 * Get unsubscribe URL for an item
 */
export async function getUnsubscribeUrl(itemId: string): Promise<string | null> {
  const item = await findItem(itemId);

  if (!item || item.connector !== 'gmail') {
    return null;
  }

  return (item.rawPayload as Record<string, unknown>)?.unsubscribeUrl as string | null || null;
}
