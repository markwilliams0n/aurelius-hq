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
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

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

  const rawPayload = item.rawPayload as Record<string, unknown>;
  const threadId = rawPayload?.threadId as string | undefined;
  const messageId = rawPayload?.messageId as string | undefined;
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

  return (item.rawPayload as Record<string, unknown>)?.unsubscribeUrl as string | null || null;
}
