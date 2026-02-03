import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, activityLog as activityLogTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { appendToDailyNote } from "@/lib/memory/daily-notes";
import { extractEmailMemory, isOllamaAvailable } from "@/lib/memory/ollama";
import { listEntities } from "@/lib/memory/entities";
import { logActivity } from "@/lib/activity";

/**
 * POST /api/triage/[id]/memory - Save triage item to daily notes for memory processing
 *
 * ARCHITECTURE: This endpoint saves rich content to daily notes.
 * The heartbeat process then extracts entities and facts from daily notes.
 * This centralizes memory processing in heartbeat for consistency.
 *
 * Flow:
 * 1. User triggers "save to memory" on a triage item
 * 2. This endpoint extracts key info using Ollama and saves to daily notes
 * 3. Heartbeat later processes daily notes → creates entities/facts in life/
 * 4. QMD indexes life/ for search
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

// Extract from triage item and save to daily notes
// Heartbeat will later process daily notes into entities/facts
async function extractAndSaveToDailyNotes(item: any): Promise<{
  factsExtracted: number;
  facts: string[];
}> {
  const senderName = item.senderName || item.sender;
  const priority = item.priority === "urgent" || item.priority === "high"
    ? ` (${item.priority.toUpperCase()})`
    : "";

  // Get email content
  let emailContent = item.content || "";
  if (!emailContent && item.rawPayload?.bodyHtml) {
    emailContent = (item.rawPayload.bodyHtml as string)
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

  // Try Ollama extraction for rich content
  const ollamaAvailable = await isOllamaAvailable();
  let extractedFacts: string[] = [];
  let summary = "";
  let actionItems: Array<{ description: string; dueDate?: string }> = [];

  if (ollamaAvailable && emailContent) {
    try {
      // Get existing entities for context
      const existingEntities = await listEntities(undefined, 30);
      const entityHints = existingEntities.map(e => ({
        name: e.name,
        type: e.type as 'person' | 'company' | 'project',
        recentFacts: [],
      }));

      const extraction = await extractEmailMemory(
        item.subject,
        item.sender,
        item.senderName,
        emailContent,
        entityHints
      );

      summary = extraction.summary;
      actionItems = extraction.actionItems;

      // Collect all facts from extraction
      for (const entity of extraction.entities) {
        extractedFacts.push(...entity.facts);
      }
      for (const fact of extraction.facts) {
        extractedFacts.push(fact.content);
      }
    } catch (error) {
      console.error("[Memory] Ollama extraction failed:", error);
    }
  }

  // Build daily note entry
  let entry = `**${senderName}** via ${item.connector}${priority}: "${item.subject}"`;

  // Add summary
  if (summary) {
    entry += `\n\n> ${summary}`;
  }

  // Add action items
  if (actionItems.length > 0) {
    entry += "\n\n**Action Items:**";
    for (const action of actionItems) {
      entry += `\n- [ ] ${action.description}${action.dueDate ? ` (due: ${action.dueDate})` : ''}`;
    }
  }

  // Add extracted facts
  if (extractedFacts.length > 0) {
    entry += "\n\n**Key Facts:**";
    for (const fact of extractedFacts.slice(0, 10)) {
      entry += `\n- ${fact}`;
    }
    if (extractedFacts.length > 10) {
      entry += `\n- _(+${extractedFacts.length - 10} more)_`;
    }
  }

  // Add content preview for heartbeat to process later
  if (emailContent && emailContent.length > 100) {
    const cleanContent = emailContent
      .replace(/https?:\/\/\S+/g, '') // Remove URLs
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    entry += `\n\n**Content:**\n${cleanContent}${emailContent.length > 1000 ? '...' : ''}`;
  }

  // Save to daily notes
  await appendToDailyNote(entry);

  return {
    factsExtracted: extractedFacts.length,
    facts: extractedFacts,
  };
}
