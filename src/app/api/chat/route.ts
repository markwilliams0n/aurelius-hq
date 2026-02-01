import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { chatStream, type Message } from "@/lib/ai/client";
import { buildChatPrompt, parseResponse } from "@/lib/ai/prompts";
import { buildMemoryContext } from "@/lib/memory/search";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

// Stored message type (with timestamp for DB)
type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  memories?: Array<{ factId: string; content: string }>;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, conversationId } = await request.json();

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get conversation history if exists
  let storedHistory: StoredMessage[] = [];
  if (conversationId) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv) {
      storedHistory = (conv.messages as StoredMessage[]) || [];
    }
  }

  // Convert stored history to AI message format (without timestamp)
  const aiHistory: Message[] = storedHistory.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Build memory context
  const memoryContext = await buildMemoryContext(message);

  // Get soul config
  const soulConfig = await getConfig("soul");

  // Build system prompt
  const systemPrompt = buildChatPrompt(
    memoryContext,
    soulConfig?.content || null
  );

  // Build messages for AI
  const aiMessages: Message[] = [
    ...aiHistory,
    { role: "user", content: message },
  ];

  // Create streaming response
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stream the response
        for await (const chunk of chatStream(aiMessages, systemPrompt)) {
          fullResponse += chunk;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`)
          );
        }

        // Parse response for memories
        const { reply, memories } = parseResponse(fullResponse);

        // Save memories
        const savedMemories: Array<{ factId: string; content: string }> = [];

        for (const mem of memories) {
          try {
            // Upsert entity
            const entity = await upsertEntity(
              mem.entity,
              mem.type as any
            );

            // Create fact
            const fact = await createFact(
              entity.id,
              mem.fact,
              mem.category as any,
              "chat",
              conversationId || undefined
            );

            savedMemories.push({
              factId: fact.id,
              content: mem.fact,
            });

            await logActivity({
              eventType: "memory_created",
              actor: "aurelius",
              description: `Remembered: ${mem.fact}`,
              metadata: {
                entityId: entity.id,
                entityName: entity.name,
                factId: fact.id,
              },
            });
          } catch (error) {
            console.error("Failed to save memory:", error);
          }
        }

        // Send memories event
        if (savedMemories.length > 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "memories", memories: savedMemories })}\n\n`
            )
          );
        }

        // Build stored messages with timestamps
        const newStoredMessages: StoredMessage[] = [
          ...storedHistory,
          {
            role: "user",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: reply,
            timestamp: new Date().toISOString(),
            memories: savedMemories.length > 0 ? savedMemories : undefined,
          },
        ];

        if (conversationId) {
          await db
            .update(conversations)
            .set({
              messages: newStoredMessages,
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, conversationId));
        } else {
          const [newConv] = await db
            .insert(conversations)
            .values({
              messages: newStoredMessages,
            })
            .returning();

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "conversation", id: newConv.id })}\n\n`
            )
          );
        }

        // Send done event
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      } catch (error) {
        console.error("Chat error:", error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "Chat failed" })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
