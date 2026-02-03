import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { chatStreamWithTools, DEFAULT_MODEL, type Message } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { extractAndSaveMemories, containsMemorableContent } from "@/lib/memory/extraction";
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

  // Build agent context (recent notes + QMD search + soul config)
  const { systemPrompt } = await buildAgentContext({ query: message });

  // Build messages for AI
  const aiMessages: Message[] = [
    ...aiHistory,
    { role: "user", content: message },
  ];

  // Create streaming response
  const encoder = new TextEncoder();
  let fullResponse = "";
  let pendingChangeId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Stream the response
        for await (const event of chatStreamWithTools(
          aiMessages,
          systemPrompt,
          conversationId || undefined
        )) {
          if (event.type === "text") {
            fullResponse += event.content;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", content: event.content })}\n\n`
              )
            );
          } else if (event.type === "tool_use") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_use", toolName: event.toolName, toolInput: event.toolInput })}\n\n`
              )
            );
          } else if (event.type === "tool_result") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_result", toolName: event.toolName, result: event.result })}\n\n`
              )
            );
          } else if (event.type === "pending_change") {
            pendingChangeId = event.changeId;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "pending_change", changeId: event.changeId })}\n\n`
              )
            );
          }
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
            content: fullResponse,
            timestamp: new Date().toISOString(),
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

        // Save to daily notes if message contains memorable content
        if (containsMemorableContent(message)) {
          try {
            await extractAndSaveMemories(message, fullResponse);
          } catch (error) {
            console.error("Failed to save to daily notes:", error);
            // Don't fail the request if memory saving fails
          }
        }

        // Estimate token count (rough approximation: ~4 chars per token)
        const totalChars = newStoredMessages.reduce(
          (sum, m) => sum + m.content.length,
          systemPrompt.length
        );
        const estimatedTokens = Math.ceil(totalChars / 4);

        // Send stats event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "stats",
              model: DEFAULT_MODEL,
              tokenCount: estimatedTokens,
            })}\n\n`
          )
        );

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
