/**
 * Linear Sync
 *
 * Syncs Linear notifications to triage inbox.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
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
 * Build a contextual preview based on notification type.
 * Instead of generic "Katie changed status", produce something like:
 *   "Katie moved to In Progress — Users are getting stuck in a redirect loop..."
 */
export function buildContextualPreview(notif: LinearNotification): string {
  const actor = notif.actor?.name ?? '';
  const issue = notif.issue;
  const desc = issue?.description?.slice(0, 150);

  // Helper to append issue description context
  const withDesc = (action: string) =>
    desc ? `${action} — ${desc}` : action;

  // For issue notifications
  if (issue) {
    switch (notif.type) {
      case 'issueStatusChanged':
        return withDesc(
          `${actor || 'Someone'} moved to ${issue.state?.name ?? 'unknown'}`
        );

      case 'issuePriorityChanged':
        return withDesc(
          `${actor || 'Someone'} set priority to ${priorityLabel(issue.priority)}`
        );

      case 'issueAssignedToYou': {
        // Actor may be null for bot-assigned issues — fall back to creator
        const assigner = actor || issue.creator?.name || issue.assignee?.name || 'Someone';
        return withDesc(`${assigner} assigned this to you`);
      }

      case 'issueNewComment':
      case 'issueCommentMention':
        if (notif.comment?.body) {
          const commenter = notif.comment.user?.name ?? (actor || 'Someone');
          return `${commenter}: ${notif.comment.body.slice(0, 180)}`;
        }
        return withDesc(`${actor || 'Someone'} commented`);

      case 'issueMention':
        return withDesc(`${actor || 'Someone'} mentioned you`);

      case 'issueDue':
        return withDesc('Issue is due soon');

      case 'issueCreated':
        return withDesc(`${actor || 'Someone'} created this issue`);

      default:
        return withDesc(notificationDescription(notif.type, notif.actor));
    }
  }

  // For project notifications
  if (notif.project) {
    const project = notif.project;
    const update = notif.projectUpdate;
    const author = update?.user?.name ?? (actor || 'Someone');

    switch (notif.type) {
      case 'projectUpdateCreated':
        // Show the update content, not the project description
        return `Project update from ${author}: ${update?.body?.slice(0, 150) || project.description?.slice(0, 150) || 'No details'}`;

      case 'projectDeleted':
        return `${actor || 'Someone'} deleted this project${project.description ? ` — ${project.description.slice(0, 150)}` : ''}`;

      case 'projectUpdateMention':
        return `${author} mentioned you in project update: ${update?.body?.slice(0, 150) || 'No details'}`;

      case 'projectUpdatePrompt':
        return `Project update reminder — time to post an update`;

      default:
        return `${actor || 'Someone'} updated project${project.description ? ` — ${project.description.slice(0, 150)}` : ''}`;
    }
  }

  // For initiative notifications
  if (notif.initiative) {
    const body = notif.initiativeUpdate?.body;
    return body?.slice(0, 200) || `Initiative update: ${notif.initiative.name}`;
  }

  return notificationDescription(notif.type, notif.actor);
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
  const project = notif.project;
  const initiative = notif.initiative;

  // Build subject based on notification type
  let subject: string;
  let content: string;
  let preview: string;
  let linearUrl: string;

  if (issue) {
    subject = `${issue.identifier}: ${issue.title}`;
    content = generateContent(notif);
    preview = buildContextualPreview(notif);
    linearUrl = issue.url;
  } else if (project) {
    const updateBody = notif.projectUpdate?.body;
    // Prefix subject based on notification type
    if (notif.type === 'projectDeleted') {
      subject = `Project deleted: ${project.name}`;
    } else if (notif.type === 'projectUpdateCreated' || notif.type === 'projectUpdateMention') {
      subject = `Project update: ${project.name}`;
    } else {
      subject = project.name;
    }
    content = updateBody || project.description || 'Project notification';
    preview = buildContextualPreview(notif);
    linearUrl = notif.projectUpdate?.url || project.url || 'https://linear.app';
  } else if (initiative) {
    const updateBody = notif.initiativeUpdate?.body;
    subject = `Initiative: ${initiative.name}`;
    content = updateBody || initiative.description || 'Initiative notification';
    preview = buildContextualPreview(notif);
    linearUrl = 'https://linear.app';
  } else {
    subject = 'Linear notification';
    content = notificationDescription(notif.type, notif.actor);
    preview = buildContextualPreview(notif);
    linearUrl = 'https://linear.app';
  }

  // Build enrichment
  const enrichment: LinearEnrichment = {
    notificationType: notif.type,
    issueId: issue?.id ?? '',
    issueIdentifier: issue?.identifier ?? '',
    issueState: issue?.state?.name ?? '',
    issueStateType: issue?.state?.type ?? '',
    issuePriority: issue?.priority ?? 0,
    issueProject: issue?.project?.name ?? project?.name,
    issueLabels: issue?.labels?.nodes?.map((l) => l.name) ?? [],
    linearUrl,
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

  return {
    connector: 'linear',
    externalId: notif.id,

    // Sender: actor, or fall back to issue creator / project update author
    sender: notif.actor?.email ?? notif.actor?.name
      ?? issue?.creator?.email ?? issue?.creator?.name
      ?? notif.projectUpdate?.user?.email ?? notif.projectUpdate?.user?.name
      ?? 'Linear',
    senderName: notif.actor?.name
      ?? issue?.creator?.name
      ?? notif.projectUpdate?.user?.name
      ?? 'Linear',
    senderAvatar: notif.actor?.avatarUrl
      ?? issue?.creator?.avatarUrl
      ?? notif.projectUpdate?.user?.avatarUrl
      ?? undefined,

    // Content
    subject,
    content,
    preview,

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
 * Reconcile existing triage items with Linear notification state.
 * Fetches the (small) set of currently unread notifications from Linear,
 * then archives any triage items NOT in that set.
 */
async function reconcileReadNotifications(): Promise<number> {
  // Get all "new" Linear items from triage
  const openLinearItems = await db
    .select({ id: inboxItems.id, externalId: inboxItems.externalId })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'linear'),
        eq(inboxItems.status, 'new')
      )
    );

  if (openLinearItems.length === 0) return 0;

  // Fetch all currently unread notification IDs from Linear
  // (fetchNotifications already filters to unread/unarchived)
  const unreadNotifIds = new Set<string>();
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await fetchNotifications(cursor);
    for (const notif of result.notifications) {
      unreadNotifIds.add(notif.id);
    }
    hasMore = result.hasMore;
    cursor = result.endCursor;

    // Safety: cap at 500 unread notifications
    if (unreadNotifIds.size > 500) {
      console.warn('[Linear] Reconciliation hit 500 notification limit - some items may not be reconciled');
      break;
    }
  }

  // Find triage items whose notification is no longer unread in Linear
  const toArchive = openLinearItems
    .filter((item) => item.externalId && !unreadNotifIds.has(item.externalId))
    .map((item) => item.id!);

  if (toArchive.length > 0) {
    await db
      .update(inboxItems)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(inArray(inboxItems.id, toArchive));

    console.log(`[Linear] Reconciled: archived ${toArchive.length} read/resolved notifications`);
  }

  return toArchive.length;
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
    // Get owner user ID to skip self-triggered notifications
    const ownerUserId = process.env.LINEAR_OWNER_USER_ID;
    if (ownerUserId) {
      console.log(`[Linear] Filtering out self-triggered notifications (owner: ${ownerUserId})`);
    }

    // Paginate through notifications
    while (hasMore) {
      const result = await fetchNotifications(cursor);

      for (const notif of result.notifications) {
        try {
          // Skip notifications triggered by the owner
          if (ownerUserId && notif.actor?.id === ownerUserId) {
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

    // Reconcile: archive items that were read/archived in Linear
    const reconciled = await reconcileReadNotifications();

    // Update sync state
    await saveSyncState({
      lastSyncAt: new Date().toISOString(),
    });

    console.log(`[Linear] Sync complete: ${synced} synced, ${skipped} skipped, ${reconciled} reconciled, ${errors} errors`);

    return { synced, skipped, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Linear] Sync failed:', message);
    return { synced, skipped, errors, error: message };
  }
}
