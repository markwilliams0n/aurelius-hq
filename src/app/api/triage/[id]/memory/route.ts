import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, activityLog as activityLogTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { appendToDailyNote } from "@/lib/memory/daily-notes";
import { addMemory } from "@/lib/memory/supermemory";
import { logActivity } from "@/lib/activity";

/**
 * POST /api/triage/[id]/memory - Save triage item to memory
 *
 * Flow:
 * 1. User triggers "save to memory" on a triage item
 * 2. Content saved to daily notes (short-term) and Supermemory (long-term)
 * 3. Supermemory handles extraction, entity resolution, and indexing
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Query database for the item
  const items = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.externalId, id))
    .limit(1);

  const item = items[0];

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Log the action immediately (queued state)
  const activityEntry = await logActivity({
    eventType: "triage_action",
    actor: "user",
    description: `Saving memory from: ${item.subject}`,
    metadata: {
      action: "memory",
      itemId: id,
      connector: item.connector,
      subject: item.subject,
      sender: item.senderName || item.sender,
      status: "processing",
    },
  });

  // Process in background (don't await)
  processMemoryInBackground(item, activityEntry.id).catch((error) => {
    console.error("[Memory] Background processing failed:", error);
  });

  // Return immediately
  return NextResponse.json({
    success: true,
    itemId: id,
    status: "queued",
    activityId: activityEntry.id,
    message: "Memory extraction started in background",
  });
}

// Background processing - extract with Ollama and save to daily notes
async function processMemoryInBackground(item: any, activityId: string) {
  const startTime = Date.now();

  try {
    const result = await extractAndSaveToDailyNotes(item);
    const duration = Date.now() - startTime;

    // Update activity log with success
    await db
      .update(activityLogTable)
      .set({
        description: `Saved memory from: ${item.subject}`,
        metadata: {
          action: "memory",
          itemId: item.externalId,
          connector: item.connector,
          subject: item.subject,
          sender: item.senderName || item.sender,
          status: "completed",
          factsCount: result.factsExtracted,
          facts: result.facts.slice(0, 5),
          durationMs: duration,
        },
      })
      .where(eq(activityLogTable.id, activityId));

    console.log(`[Memory] Saved to daily notes in ${duration}ms (${result.factsExtracted} facts extracted)`);
  } catch (error) {
    const duration = Date.now() - startTime;

    // Update activity log with error
    await db
      .update(activityLogTable)
      .set({
        description: `Failed to extract memory from: ${item.subject}`,
        metadata: {
          action: "memory",
          itemId: item.externalId,
          connector: item.connector,
          subject: item.subject,
          sender: item.senderName || item.sender,
          status: "failed",
          error: String(error),
          durationMs: duration,
        },
      })
      .where(eq(activityLogTable.id, activityId));

    console.error("[Memory] Background extraction failed:", error);
  }
}

// Extract from triage item, save to daily notes, and send to Supermemory
async function extractAndSaveToDailyNotes(item: any): Promise<{
  factsExtracted: number;
  facts: string[];
}> {
  const senderName = item.senderName || item.sender;
  const priority = item.priority === "urgent" || item.priority === "high"
    ? ` (${item.priority.toUpperCase()})`
    : "";

  // Get content
  let content = item.content || "";
  if (!content && item.rawPayload?.bodyHtml) {
    content = (item.rawPayload.bodyHtml as string)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Build daily note entry
  let entry = `**${senderName}** via ${item.connector}${priority}: "${item.subject}"`;

  if (content && content.length > 100) {
    const cleanContent = content
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    entry += `\n\n**Content:**\n${cleanContent}${content.length > 1000 ? '...' : ''}`;
  }

  // Save to daily notes (short-term context)
  await appendToDailyNote(entry);

  // Send to Supermemory for long-term memory (fire-and-forget)
  // Supermemory handles extraction, entity resolution, and indexing
  const supermemoryContent = `From: ${senderName} via ${item.connector}\nSubject: ${item.subject}\n\n${content}`;
  addMemory(supermemoryContent, {
    source: item.connector,
    subject: item.subject,
    sender: senderName,
  }).catch((error) => {
    console.error("[Memory] Supermemory add failed:", error);
  });

  return {
    factsExtracted: 0,
    facts: [],
  };
}
