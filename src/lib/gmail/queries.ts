/**
 * Shared query helpers for Gmail/triage items.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, or } from 'drizzle-orm';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find an inbox item by UUID id or externalId.
 * Gmail items use threadId as externalId which isn't a valid UUID,
 * so we check the format and query accordingly.
 */
export async function findInboxItem(itemId: string) {
  const [item] = await db
    .select()
    .from(inboxItems)
    .where(
      uuidRegex.test(itemId)
        ? or(eq(inboxItems.id, itemId), eq(inboxItems.externalId, itemId))
        : eq(inboxItems.externalId, itemId)
    )
    .limit(1);
  return item ?? null;
}
