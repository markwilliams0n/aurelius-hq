/**
 * Granola Sync
 *
 * Syncs Granola meetings to triage inbox.
 * Called by heartbeat process.
 */

import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { insertInboxItemWithTasks } from '@/lib/triage/insert-with-tasks';
import {
  isConfigured,
  getCredentials,
  getDocumentsSince,
  getDocument,
  getDocumentTranscript,
  type GranolaDocumentFull,
  type GranolaTranscriptUtterance,
} from './client';
import {
  getSyncState,
  setSyncState,
} from '@/lib/connectors/sync-state';
import {
  extractMeetingMemory,
  extractAttendeesAsEntities,
  type MeetingMemoryExtraction,
} from './extract-memory';
import { upsertEntity } from '@/lib/memory/entities';
import { createFact } from '@/lib/memory/facts';
import { addMemory } from '@/lib/memory/supermemory';

export interface GranolaSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  meetings: Array<{ id: string; title: string }>;
}

/**
 * Format transcript utterances into readable text
 */
function formatTranscript(utterances: GranolaTranscriptUtterance[]): string {
  if (!utterances || utterances.length === 0) return '';

  // Group consecutive utterances by same speaker for readability
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];

  for (const u of utterances) {
    const speaker = u.source === 'microphone' ? 'You' : 'Them';

    if (speaker !== currentSpeaker) {
      // Flush previous speaker's text
      if (currentSpeaker && currentText.length > 0) {
        lines.push(`**${currentSpeaker}:** ${currentText.join(' ')}`);
      }
      currentSpeaker = speaker;
      currentText = [u.text];
    } else {
      currentText.push(u.text);
    }
  }

  // Flush final speaker
  if (currentSpeaker && currentText.length > 0) {
    lines.push(`**${currentSpeaker}:** ${currentText.join(' ')}`);
  }

  return lines.join('\n\n');
}

/**
 * Transform a Granola document into a triage inbox item
 */
function transformToInboxItem(
  doc: GranolaDocumentFull,
  transcript: GranolaTranscriptUtterance[] = [],
  extractedMemory?: MeetingMemoryExtraction
) {
  // API returns google_calendar_event, not google_calendar_data
  const calendarEvent = (doc as unknown as { google_calendar_event?: typeof doc.google_calendar_data })
    .google_calendar_event;
  const organizer = calendarEvent?.organizer;
  const attendees = calendarEvent?.attendees || [];

  // API returns notes_markdown, not markdown
  const markdown = (doc as unknown as { notes_markdown?: string }).notes_markdown || '';

  // Format transcript
  const transcriptText = formatTranscript(transcript);

  // Build attendee list for display
  const attendeeNames = attendees
    .map((a: { displayName?: string; email?: string }) => a.displayName || a.email)
    .filter(Boolean)
    .slice(0, 5);

  // Format meeting time
  const startTime = calendarEvent?.start?.dateTime
    ? new Date(calendarEvent.start.dateTime).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  // Build preview from transcript, markdown, or meeting info
  let preview: string;
  let content: string;

  // Build content - prefer notes, then transcript, then meeting info
  const contentParts = [`# ${doc.title}`, ''];
  if (startTime) contentParts.push(`**When:** ${startTime}`);
  if (organizer?.email) contentParts.push(`**Organizer:** ${organizer.displayName || organizer.email}`);
  if (attendeeNames.length > 0) {
    contentParts.push('', '**Attendees:**');
    attendeeNames.forEach(name => contentParts.push(`- ${name}`));
  }

  if (markdown) {
    contentParts.push('', '---', '', '## Notes', '', markdown);
    preview = markdown.slice(0, 200).replace(/\n/g, ' ').trim();
    if (preview.length >= 200) preview += '...';
  } else if (transcriptText) {
    contentParts.push('', '---', '', '## Transcript', '', transcriptText);
    preview = transcriptText.slice(0, 200).replace(/\n/g, ' ').replace(/\*\*/g, '').trim();
    if (preview.length >= 200) preview += '...';
  } else {
    contentParts.push('', '*No notes or transcript available yet*');
    const attendeeStr = attendeeNames.length > 0
      ? `Attendees: ${attendeeNames.join(', ')}`
      : '';
    preview = `Meeting${startTime ? ` at ${startTime}` : ''}. ${attendeeStr}`.trim();
  }

  content = contentParts.join('\n');

  return {
    connector: 'granola' as const,
    externalId: doc.id,
    sender: organizer?.email || 'meeting',
    senderName: organizer?.displayName || doc.title,
    subject: doc.title,
    preview,
    content,
    rawPayload: {
      notes: markdown,
      transcript: transcript,
      attendees: attendees,
      calendarEvent: calendarEvent,
      people: (doc as unknown as { people?: unknown[] }).people,
      summary: (doc as unknown as { summary?: string }).summary,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    },
    receivedAt: new Date(calendarEvent?.start?.dateTime || doc.created_at),
    status: 'new' as const,
    priority: 'normal' as const,
    enrichment: {
      attendees: attendeeNames.join(', '),
      meetingTime: startTime,
      // Extracted memory ready for review
      extractedMemory: extractedMemory || undefined,
      summary: extractedMemory?.summary,
      topics: extractedMemory?.topics || [],
      actionItems: extractedMemory?.actionItems || [],
    },
  };
}

/**
 * Auto-save extracted memory to the memory system
 */
async function saveExtractedMemory(
  extractedMemory: MeetingMemoryExtraction,
  sourceId: string,
  meetingTitle: string
): Promise<{ entitiesSaved: number; factsSaved: number }> {
  let entitiesSaved = 0;
  let factsSaved = 0;

  // Save entities and their associated facts
  for (const entity of extractedMemory.entities) {
    try {
      const savedEntity = await upsertEntity(entity.name, entity.type as any, {
        role: entity.role,
        sourceMeeting: meetingTitle,
        sourceItemId: sourceId,
      });
      entitiesSaved++;

      // Save facts associated with this entity
      for (const factContent of entity.facts) {
        try {
          await createFact(
            savedEntity.id,
            factContent,
            'context',
            'document',
            sourceId
          );
          factsSaved++;
        } catch (factError) {
          console.warn(`[Granola] Failed to save fact for ${entity.name}:`, factError);
        }
      }
    } catch (entityError) {
      console.warn(`[Granola] Failed to save entity ${entity.name}:`, entityError);
    }
  }

  // Save standalone facts (those with entityName reference)
  for (const fact of extractedMemory.facts) {
    if (fact.entityName) {
      try {
        // Find or create the referenced entity
        const entity = await upsertEntity(fact.entityName, 'person', {
          sourceMeeting: meetingTitle,
        });
        await createFact(
          entity.id,
          fact.content,
          fact.category as any,
          'document',
          sourceId
        );
        factsSaved++;
      } catch (factError) {
        console.warn(`[Granola] Failed to save standalone fact:`, factError);
      }
    }
  }

  return { entitiesSaved, factsSaved };
}

/**
 * Save a formatted meeting summary to Supermemory
 * for semantic search and email classifier context.
 */
async function saveMeetingToSupermemory(
  title: string,
  attendees: string[],
  extraction: MeetingMemoryExtraction,
  meetingDate: string
): Promise<void> {
  const parts = [
    `Meeting: ${title} (${meetingDate})`,
    attendees.length > 0 ? `Attendees: ${attendees.join(', ')}` : '',
    extraction.summary ? `Summary: ${extraction.summary}` : '',
  ];

  if (extraction.facts.length > 0) {
    parts.push('Key facts:');
    for (const fact of extraction.facts.slice(0, 10)) {
      parts.push(`- ${fact.content}`);
    }
  }

  if (extraction.actionItems.length > 0) {
    parts.push('Action items:');
    for (const item of extraction.actionItems) {
      const assignee = item.assignee ? ` [${item.assignee}]` : '';
      parts.push(`-${assignee} ${item.description}`);
    }
  }

  if (extraction.topics.length > 0) {
    parts.push(`Topics: ${extraction.topics.join(', ')}`);
  }

  const content = parts.filter(Boolean).join('\n');

  await addMemory(content, {
    type: 'meeting',
    source: 'granola',
    title,
    date: meetingDate,
  });
}

/**
 * Check if a meeting is already in triage.
 * Returns the existing item's id and status, or null if not found.
 */
async function findExistingMeeting(externalId: string): Promise<{ id: string; status: string } | null> {
  const existing = await db
    .select({ id: inboxItems.id, status: inboxItems.status })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.connector, 'granola'),
        eq(inboxItems.externalId, externalId)
      )
    )
    .limit(1);

  return existing.length > 0 ? existing[0] : null;
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

  // Read sync state from DB (separate from credentials)
  const syncState = await getSyncState<{ lastSyncedAt?: string }>('sync:granola');

  // Determine sync window - default to last 7 days if never synced
  const lastSynced = syncState?.lastSyncedAt
    ? new Date(syncState.lastSyncedAt)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  console.log(`[Granola] Fetching meetings since ${lastSynced.toISOString()}`);

  try {
    // Fetch meetings since last sync
    const documents = await getDocumentsSince(lastSynced);
    console.log(`[Granola] Found ${documents.length} meetings to process`);

    for (const doc of documents) {
      try {
        // Skip if already imported (any status — respect user's archive/snooze)
        const existing = await findExistingMeeting(doc.id);
        if (existing) {
          if (existing.status !== 'new') {
            console.log(`[Granola] Skipping ${existing.status} meeting: ${doc.title}`);
          }
          result.skipped++;
          continue;
        }

        // Fetch full document and transcript
        const fullDoc = await getDocument(doc.id);
        const transcript = await getDocumentTranscript(doc.id);

        // Extract memory from meeting (AI analysis)
        let extractedMemory: MeetingMemoryExtraction | undefined;
        const calendarEvent = (fullDoc as unknown as { google_calendar_event?: { attendees?: Array<{ displayName?: string; email?: string }> } })
          .google_calendar_event;
        const attendees = calendarEvent?.attendees || [];
        const transcriptText = formatTranscript(transcript);
        const notes = (fullDoc as unknown as { notes_markdown?: string }).notes_markdown || '';

        if (transcriptText || notes) {
          console.log(`[Granola] Extracting memory from: ${doc.title}`);
          try {
            extractedMemory = await extractMeetingMemory(
              doc.title,
              attendees.map(a => ({ name: a.displayName, email: a.email })),
              transcriptText,
              notes
            );
            console.log(`[Granola] Extracted ${extractedMemory.entities.length} entities, ${extractedMemory.facts.length} facts`);

            // Auto-save extracted memory to the memory system
            try {
              const { entitiesSaved, factsSaved } = await saveExtractedMemory(
                extractedMemory,
                doc.id,
                doc.title
              );
              console.log(`[Granola] Auto-saved: ${entitiesSaved} entities, ${factsSaved} facts to memory`);
            } catch (saveError) {
              console.warn(`[Granola] Memory auto-save failed (will still sync to triage):`, saveError);
            }

            // Save formatted summary to Supermemory (for semantic search + email classifier)
            try {
              const meetingDate = (calendarEvent as { start?: { dateTime?: string } } | undefined)?.start?.dateTime
                ? new Date((calendarEvent as { start: { dateTime: string } }).start.dateTime).toLocaleDateString()
                : new Date(doc.created_at).toLocaleDateString();
              const attendeeNames = attendees
                .map((a: { displayName?: string; email?: string }) => a.displayName || a.email)
                .filter(Boolean) as string[];

              await saveMeetingToSupermemory(doc.title, attendeeNames, extractedMemory, meetingDate);
              console.log(`[Granola] Saved meeting summary to Supermemory: ${doc.title}`);
            } catch (smError) {
              console.warn(`[Granola] Supermemory save failed (non-blocking):`, smError);
            }
          } catch (extractError) {
            console.warn(`[Granola] Memory extraction failed, using fallback:`, extractError);
            // Fallback: just extract attendees as entities
            extractedMemory = {
              entities: extractAttendeesAsEntities(attendees),
              facts: [],
              actionItems: [],
              summary: '',
              topics: [],
            };
          }
        }

        // Transform and insert into triage with task extraction
        const item = transformToInboxItem(fullDoc, transcript, extractedMemory);
        await insertInboxItemWithTasks(item, {
          // Use pre-extracted action items from Granola instead of running AI again
          existingActionItems: extractedMemory?.actionItems,
          extractionContext: {
            attendees: item.enrichment?.attendees || undefined,
            transcript: transcriptText || undefined,
          },
        });

        result.synced++;
        result.meetings.push({ id: doc.id, title: doc.title });
        console.log(`[Granola] Synced: ${doc.title}`);
      } catch (error) {
        console.error(`[Granola] Error syncing ${doc.id}:`, error);
        result.errors++;
      }
    }

    // Update last synced timestamp in DB (credentials stay in file)
    await setSyncState('sync:granola', {
      lastSyncedAt: new Date().toISOString(),
    });

    console.log(`[Granola] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[Granola] Sync failed:', error);
    throw error;
  }

  return result;
}
