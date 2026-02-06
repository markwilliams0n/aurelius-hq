import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, activityLog as activityLogTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { appendToDailyNote } from "@/lib/memory/daily-notes";
import { addMemory } from "@/lib/memory/supermemory";
import { logActivity } from "@/lib/activity";
import { isOllamaAvailable, generate } from "@/lib/memory/ollama";

type MemoryMode = "full" | "summary";

/**
 * POST /api/triage/[id]/memory - Save triage item to memory
 *
 * Body: { mode?: "full" | "summary" }
 *   - "summary" (default): Ollama summarizes before sending to Supermemory (saves tokens)
 *   - "full": Send raw content to Supermemory
 *
 * Daily notes always get full content regardless of mode.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse mode from body
  let mode: MemoryMode = "summary";
  try {
    const body = await request.json().catch(() => ({}));
    if (body.mode === "full" || body.mode === "summary") {
      mode = body.mode;
    }
  } catch {
    // No body, use default
  }

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
    description: `Saving memory (${mode}) from: ${item.subject}`,
    metadata: {
      action: "memory",
      mode,
      itemId: id,
      connector: item.connector,
      subject: item.subject,
      sender: item.senderName || item.sender,
      status: "processing",
    },
  });

  // Process in background (don't await)
  processMemoryInBackground(item, activityEntry.id, mode).catch(async (error) => {
    console.error("[Memory] Background processing failed:", error);
    try {
      await db
        .update(activityLogTable)
        .set({
          description: `Memory save crashed: ${item.subject}`,
          metadata: {
            action: "memory",
            mode,
            itemId: id,
            status: "crashed",
            error: String(error),
          },
        })
        .where(eq(activityLogTable.id, activityEntry.id));
    } catch {
      // Last resort — activity log update also failed
    }
  });

  // Return immediately
  return NextResponse.json({
    success: true,
    itemId: id,
    mode,
    status: "queued",
    activityId: activityEntry.id,
  });
}

// Background processing
async function processMemoryInBackground(item: any, activityId: string, mode: MemoryMode) {
  const startTime = Date.now();

  try {
    const result = await extractAndSaveMemory(item, mode);
    const duration = Date.now() - startTime;

    await db
      .update(activityLogTable)
      .set({
        description: `Saved memory (${result.effectiveMode}) from: ${item.subject}`,
        metadata: {
          action: "memory",
          mode: result.effectiveMode,
          itemId: item.externalId,
          connector: item.connector,
          subject: item.subject,
          sender: item.senderName || item.sender,
          status: "completed",
          durationMs: duration,
        },
      })
      .where(eq(activityLogTable.id, activityId));

    console.log(`[Memory] Saved (${result.effectiveMode}) in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;

    await db
      .update(activityLogTable)
      .set({
        description: `Failed to save memory from: ${item.subject}`,
        metadata: {
          action: "memory",
          mode,
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

    console.error("[Memory] Background processing failed:", error);
  }
}

// Summarize content using Ollama
async function summarizeForMemory(
  content: string,
  sender: string,
  connector: string,
  subject: string
): Promise<string | null> {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return null;

  try {
    const prompt = `Summarize this message for long-term memory storage. Keep key facts, people, decisions, and action items. Be concise (2-4 sentences).

From: ${sender} via ${connector}
Subject: ${subject}

${content.slice(0, 4000)}`;

    return await generate(prompt, { temperature: 0.1, maxTokens: 500 });
  } catch (error) {
    console.error("[Memory] Ollama summarization failed:", error);
    return null;
  }
}

// Extract from triage item, save to daily notes, and send to Supermemory
async function extractAndSaveMemory(
  item: any,
  mode: MemoryMode
): Promise<{ effectiveMode: MemoryMode }> {
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

  // Summarize if needed (used for both daily notes and Supermemory)
  let effectiveMode = mode;
  let memoryContent: string;

  if (mode === "summary") {
    const summary = await summarizeForMemory(content, senderName, item.connector, item.subject);
    if (summary) {
      memoryContent = summary;
    } else {
      console.warn("[Memory] Ollama unavailable, falling back to full mode");
      effectiveMode = "full";
      memoryContent = content;
    }
  } else {
    memoryContent = content;
  }

  // Daily note entry
  let entry = `**${senderName}** via ${item.connector}${priority}: "${item.subject}"`;
  if (memoryContent && memoryContent.length > 100) {
    const cleanContent = memoryContent
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    entry += `\n\n**Content:**\n${cleanContent}${memoryContent.length > 1000 ? '...' : ''}`;
  }
  await appendToDailyNote(entry);

  // Supermemory
  const supermemoryContent = `From: ${senderName} via ${item.connector}\nSubject: ${item.subject}\n\n${memoryContent}`;

  await addMemory(supermemoryContent, {
    source: item.connector,
    subject: item.subject,
    sender: senderName,
    mode: effectiveMode,
  });

  return { effectiveMode };
}
