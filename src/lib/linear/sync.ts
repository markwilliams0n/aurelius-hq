/**
 * Linear Sync
 *
 * Syncs Linear notifications to triage inbox.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  isConfigured,
  fetchNotifications,
  getSyncState,
  saveSyncState,
  priorityLabel,
  notificationDescription,
} from './client';
import type {
  LinearNotification,
  LinearEnrichment,
  LinearSyncResult,
} from './types';
import type { NewInboxItem } from '@/lib/db/schema/triage';

/**
 * Check if a notification is already in triage
 */
async function notificationExists(notificationId: string): Promise<boolean> {
  const existing = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'linear'),
        eq(inboxItems.externalId, notificationId)
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Generate content based on notification type
 */
function generateContent(notif: LinearNotification): string {
  const parts: string[] = [];

  // Add issue description if available
  if (notif.issue?.description) {
    parts.push(notif.issue.description);
  }

  // Add comment body if this is a comment notification
  if (notif.comment?.body) {
    if (parts.length > 0) {
      parts.push('\n---\n');
    }
    parts.push(`**Comment:**\n${notif.comment.body}`);
  }

  return parts.join('\n') || 'No description';
}

/**
 * Generate smart tags based on notification and issue
 */
function generateTags(notif: LinearNotification): string[] {
  const tags: string[] = [];

  // Priority tags
  if (notif.issue?.priority === 1) {
    tags.push('Urgent');
  } else if (notif.issue?.priority === 2) {
    tags.push('High');
  }

  // Notification type tags
  if (notif.type === 'issueAssignedToYou') {
    tags.push('Assigned');
  } else if (notif.type.includes('Mention')) {
    tags.push('Mentioned');
  }

  // Project tag
  if (notif.issue?.project?.name) {
    tags.push(notif.issue.project.name);
  }

  // Label-based tags (only common ones)
  const labelNames = notif.issue?.labels?.nodes?.map((l) => l.name) ?? [];
  if (labelNames.some((n) => n.toLowerCase() === 'bug')) {
    tags.push('Bug');
  }
  if (labelNames.some((n) => n.toLowerCase() === 'feature')) {
    tags.push('Feature');
  }

  return tags;
}

/**
 * Map priority to triage priority
 */
function mapPriority(linearPriority: number): 'urgent' | 'high' | 'normal' | 'low' {
  switch (linearPriority) {
    case 1:
      return 'urgent';
    case 2:
      return 'high';
    case 3:
      return 'normal';
    case 4:
      return 'low';
    default:
      return 'normal';
  }
}

/**
 * Map a Linear notification to an inbox item
 */
function mapNotificationToInboxItem(notif: LinearNotification): NewInboxItem {
  const issue = notif.issue;

  // Build subject: "ENG-123: Issue title"
  const subject = issue
    ? `${issue.identifier}: ${issue.title}`
    : 'Linear notification';

  // Build enrichment
  const enrichment: LinearEnrichment = {
    notificationType: notif.type,
    issueId: issue?.id ?? '',
    issueIdentifier: issue?.identifier ?? '',
    issueState: issue?.state?.name ?? 'Unknown',
    issueStateType: issue?.state?.type ?? 'unknown',
    issuePriority: issue?.priority ?? 0,
    issueProject: issue?.project?.name,
    issueLabels: issue?.labels?.nodes?.map((l) => l.name) ?? [],
    linearUrl: issue?.url ?? 'https://linear.app',
  };

  // Add actor if present
  if (notif.actor) {
    enrichment.actor = {
      id: notif.actor.id,
      name: notif.actor.name,
      email: notif.actor.email,
      avatarUrl: notif.actor.avatarUrl,
    };
  }

  // Generate content description
  const description = notificationDescription(notif.type, notif.actor);

  return {
    connector: 'linear',
    externalId: notif.id,

    // Sender is the actor who triggered
    sender: notif.actor?.email ?? notif.actor?.name ?? 'Linear',
    senderName: notif.actor?.name ?? 'Linear',
    senderAvatar: notif.actor?.avatarUrl ?? undefined,

    // Content
    subject,
    content: generateContent(notif),
    preview: issue?.description?.slice(0, 200) ?? description,

    // Triage state
    status: 'new',
    priority: issue ? mapPriority(issue.priority) : 'normal',
    tags: generateTags(notif),

    // Raw data for future PM view
    rawPayload: notif as unknown as Record<string, unknown>,

    // Enrichment
    enrichment: enrichment as unknown as Record<string, unknown>,

    // Timestamps
    receivedAt: new Date(notif.createdAt),
  };
}

/**
 * Sync Linear notifications to triage inbox
 */
export async function syncLinearNotifications(): Promise<LinearSyncResult> {
  // Check configuration
  if (!isConfigured()) {
    return { synced: 0, skipped: 0, errors: 0, error: 'LINEAR_API_KEY not configured' };
  }

  console.log('[Linear] Starting notification sync...');

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined;
  let hasMore = true;

  try {
    // Paginate through notifications
    while (hasMore) {
      const result = await fetchNotifications(cursor);

      for (const notif of result.notifications) {
        try {
          // Skip if no issue (rare edge case)
          if (!notif.issue) {
            console.log(`[Linear] Skipping notification ${notif.id}: no associated issue`);
            skipped++;
            continue;
          }

          // Skip if already in triage
          if (await notificationExists(notif.id)) {
            skipped++;
            continue;
          }

          // Map and insert
          const item = mapNotificationToInboxItem(notif);
          await db.insert(inboxItems).values(item);

          console.log(`[Linear] Synced: ${item.subject}`);
          synced++;
        } catch (error) {
          console.error(`[Linear] Error processing notification ${notif.id}:`, error);
          errors++;
        }
      }

      hasMore = result.hasMore;
      cursor = result.endCursor;

      // Safety: don't sync more than 200 notifications at once
      if (synced + skipped + errors > 200) {
        console.log('[Linear] Reached sync limit (200), stopping');
        break;
      }
    }

    // Update sync state
    await saveSyncState({
      lastSyncAt: new Date().toISOString(),
    });

    console.log(`[Linear] Sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);

    return { synced, skipped, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Linear] Sync failed:', message);
    return { synced, skipped, errors, error: message };
  }
}
