/**
 * Granola Sync
 *
 * Syncs Granola meetings to triage inbox.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  isConfigured,
  getCredentials,
  saveCredentials,
  getDocumentsSince,
  getDocument,
  type GranolaDocumentFull,
} from './client';

export interface GranolaSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  meetings: Array<{ id: string; title: string }>;
}

/**
 * Transform a Granola document into a triage inbox item
 */
function transformToInboxItem(doc: GranolaDocumentFull) {
  const calendarData = doc.google_calendar_data;
  const organizer = calendarData?.organizer;
  const attendees = calendarData?.attendees || [];

  // Build preview from markdown content
  const preview = doc.markdown
    ? doc.markdown.slice(0, 200).replace(/\n/g, ' ').trim()
    : 'No notes available';

  // Build attendee list for display
  const attendeeNames = attendees
    .map(a => a.displayName || a.email)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');

  return {
    connector: 'granola' as const,
    externalId: doc.id,
    sender: organizer?.email || 'meeting',
    senderName: organizer?.displayName || doc.title,
    subject: doc.title,
    preview: preview + (preview.length >= 200 ? '...' : ''),
    content: doc.markdown || '',
    rawPayload: {
      transcript: doc.transcript,
      attendees: attendees,
      calendarEvent: calendarData,
      transcriptState: doc.transcript_state,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    },
    receivedAt: new Date(calendarData?.start?.dateTime || doc.created_at),
    status: 'new' as const,
    priority: 'normal' as const,
    aiEnrichment: {
      attendees: attendeeNames,
    },
  };
}

/**
 * Check if a meeting is already in triage
 */
async function meetingExists(externalId: string): Promise<boolean> {
  const existing = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'granola'),
        eq(inboxItems.externalId, externalId)
      )
    )
    .limit(1);

  return existing.length > 0;
}

/**
 * Sync Granola meetings to triage inbox.
 * Fetches meetings since last sync and adds new ones to triage.
 */
export async function syncGranolaMeetings(): Promise<GranolaSyncResult> {
  const result: GranolaSyncResult = {
    synced: 0,
    skipped: 0,
    errors: 0,
    meetings: [],
  };

  // Check if Granola is configured
  if (!(await isConfigured())) {
    console.log('[Granola] Not configured, skipping sync');
    return result;
  }

  console.log('[Granola] Starting sync...');

  const creds = await getCredentials();
  if (!creds) return result;

  // Determine sync window - default to last 7 days if never synced
  const lastSynced = creds.last_synced_at
    ? new Date(creds.last_synced_at)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  console.log(`[Granola] Fetching meetings since ${lastSynced.toISOString()}`);

  try {
    // Fetch meetings since last sync
    const documents = await getDocumentsSince(lastSynced);
    console.log(`[Granola] Found ${documents.length} meetings to process`);

    for (const doc of documents) {
      try {
        // Skip if already imported
        if (await meetingExists(doc.id)) {
          result.skipped++;
          continue;
        }

        // Fetch full document with transcript
        const fullDoc = await getDocument(doc.id);

        // Transform and insert into triage
        const item = transformToInboxItem(fullDoc);
        await db.insert(inboxItems).values(item);

        result.synced++;
        result.meetings.push({ id: doc.id, title: doc.title });
        console.log(`[Granola] Synced: ${doc.title}`);
      } catch (error) {
        console.error(`[Granola] Error syncing ${doc.id}:`, error);
        result.errors++;
      }
    }

    // Update last synced timestamp
    await saveCredentials({
      ...creds,
      last_synced_at: new Date().toISOString(),
    });

    console.log(`[Granola] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[Granola] Sync failed:', error);
    throw error;
  }

  return result;
}
