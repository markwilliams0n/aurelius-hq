import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, activityLog as activityLogTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { appendToDailyNote } from "@/lib/memory/daily-notes";
import { addMemory } from "@/lib/memory/supermemory";
import { logActivity } from "@/lib/activity";
import { isOllamaAvailable, generate } from "@/lib/memory/ollama";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";

type MemoryMode = "full" | "summary";

interface ExtractedEntity {
  name: string;
  type: "person" | "company" | "project";
  role?: string;
  facts: string[];
}

interface ExtractedFact {
  content: string;
  category: "status" | "preference" | "relationship" | "context" | "milestone";
  entityName?: string;
  confidence: string;
}

interface ExtractedMemory {
  entities?: ExtractedEntity[];
  facts?: ExtractedFact[];
  actionItems?: Array<{ description: string; assignee?: string }>;
  summary?: string;
  topics?: string[];
}

/**
 * POST /api/triage/[id]/memory - Save triage item to memory
 *
 * Two modes based on request body shape:
 *
 * 1. Single-item mode (default): { mode?: "full" | "summary" }
 *    - "summary" (default): Ollama summarizes before sending to Supermemory
 *    - "full": Send raw content to Supermemory
 *
 * 2. Bulk/extracted mode: { extractedMemory: ExtractedMemory }
 *    - Saves pre-extracted entities, facts, action items to memory
 *    - Used by Granola meeting imports and similar structured data
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse body — determine flow based on shape
  let body: Record<string, unknown> = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    // No body, use defaults
  }

  // If body has extractedMemory, use the bulk flow
  if (body.extractedMemory) {
    return handleBulkMemory(id, body.extractedMemory as ExtractedMemory);
  }

  // Otherwise, single-item flow
  let mode: MemoryMode = "summary";
  if (body.mode === "full" || body.mode === "summary") {
    mode = body.mode as MemoryMode;
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

/**
 * Handle bulk/extracted memory save — entities, facts, action items
 * from structured data (e.g. Granola meeting imports).
 */
async function handleBulkMemory(itemId: string, extractedMemory: ExtractedMemory) {
  try {
    let savedCount = 0;
    const errors: string[] = [];

    // Save entities and their facts
    if (extractedMemory.entities) {
      for (const entity of extractedMemory.entities) {
        try {
          const savedEntity = await upsertEntity(entity.name, entity.type, {
            role: entity.role,
            sourceItemId: itemId,
          });
          savedCount++;

          for (const factContent of entity.facts) {
            try {
              await createFact(
                savedEntity.id,
                factContent,
                "context",
                "document",
                itemId
              );
              savedCount++;
            } catch (factError) {
              console.error(`Failed to save fact for ${entity.name}:`, factError);
              errors.push(`Fact for ${entity.name}: ${factContent.slice(0, 30)}...`);
            }
          }
        } catch (entityError) {
          console.error(`Failed to save entity ${entity.name}:`, entityError);
          errors.push(`Entity: ${entity.name}`);
        }
      }
    }

    // Save standalone facts
    if (extractedMemory.facts) {
      for (const fact of extractedMemory.facts) {
        try {
          let entityId: string | null = null;
          if (fact.entityName) {
            const entity = await upsertEntity(fact.entityName, "person", {});
            entityId = entity.id;
          }

          if (entityId) {
            await createFact(
              entityId,
              fact.content,
              fact.category as "status" | "preference" | "relationship" | "context" | "milestone",
              "document",
              itemId
            );
          } else {
            console.log(`Skipping fact without entity: ${fact.content.slice(0, 50)}...`);
          }
          savedCount++;
        } catch (factError) {
          console.error(`Failed to save fact:`, factError);
          errors.push(`Fact: ${fact.content.slice(0, 30)}...`);
        }
      }
    }

    // Append summary to daily notes if present
    if (extractedMemory.summary) {
      try {
        const noteEntry = `### Meeting Memory Saved

**Summary:** ${extractedMemory.summary}

${extractedMemory.topics?.length ? `**Topics:** ${extractedMemory.topics.join(", ")}` : ""}

${extractedMemory.actionItems?.length ? `**Action Items:**\n${extractedMemory.actionItems.map(a => `- ${a.description}${a.assignee ? ` (@${a.assignee})` : ""}`).join("\n")}` : ""}

*${savedCount} items saved to memory*
`;
        await appendToDailyNote(noteEntry);
      } catch (noteError) {
        console.error("Failed to append to daily notes:", noteError);
      }
    }

    return NextResponse.json({
      success: true,
      saved: savedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Bulk memory save failed:", error);
    return NextResponse.json(
      { error: "Failed to save memory", details: String(error) },
      { status: 500 }
    );
  }
}
