import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { chatStreamWithTools, DEFAULT_MODEL, type Message } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { extractAndSaveMemories } from "@/lib/memory/extraction";
import { emitMemoryEvent } from "@/lib/memory/events";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createCard, generateCardId } from "@/lib/action-cards/db";
import type { CardPattern } from "@/lib/types/action-card";
import type { ChatContext } from "@/lib/types/chat-context";

export const runtime = "nodejs";
export const maxDuration = 60;

// Stored message type (with timestamp and stable ID for DB)
type StoredMessage = {
  id?: string; // stable ID for card<->message association
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

  const { message, conversationId, context } = await request.json() as {
    message: string;
    conversationId?: string;
    context?: ChatContext;
  };

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
  const { systemPrompt } = await buildAgentContext({ query: message, context });

  // Build messages for AI
  const aiMessages: Message[] = [
    ...aiHistory,
    { role: "user", content: message },
  ];

  // Create streaming response
  const encoder = new TextEncoder();
  let fullResponse = "";
  let pendingChangeId: string | null = null;

  // Generate stable IDs for this exchange (used to associate cards with messages)
  const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const assistantMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Tell the client which assistant message ID to use for this response
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "assistant_message_id", id: assistantMessageId })}\n\n`
          )
        );

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
            // Check if tool result contains an action card — persist to DB and emit
            try {
              const parsed = JSON.parse(event.result);
              if (parsed.action_card) {
                const cardId = generateCardId();
                const ac = parsed.action_card;
                const card = await createCard({
                  id: cardId,
                  messageId: assistantMessageId,
                  conversationId: conversationId || undefined,
                  pattern: (ac.pattern || "approval") as CardPattern,
                  status: "pending",
                  title: ac.title || "Action",
                  data: ac.data || {},
                  handler: ac.handler || null,
                });
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "action_card",
                      card,
                    })}\n\n`
                  )
                );
              }
            } catch {
              // Not JSON or no action_card — that's fine
            }
          } else if (event.type === "pending_change") {
            pendingChangeId = event.changeId;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "pending_change", changeId: event.changeId })}\n\n`
              )
            );
          }
        }

        // Build stored messages with timestamps and stable IDs
        const newStoredMessages: StoredMessage[] = [
          ...storedHistory,
          {
            id: userMessageId,
            role: "user",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            id: assistantMessageId,
            role: "assistant",
            content: fullResponse,
            timestamp: new Date().toISOString(),
          },
        ];

        if (conversationId) {
          // Check if conversation exists (may not for first triage-{itemId} message)
          const [existing] = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

          if (existing) {
            await db
              .update(conversations)
              .set({
                messages: newStoredMessages,
                updatedAt: new Date(),
              })
              .where(eq(conversations.id, conversationId));
          } else {
            // First message in this conversation — create with the provided ID
            await db
              .insert(conversations)
              .values({
                id: conversationId,
                messages: newStoredMessages,
              });
          }
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

        // Emit chat response event for debug analysis
        emitMemoryEvent({
          eventType: 'recall',
          trigger: 'chat',
          summary: `Chat response for: "${message.slice(0, 60)}"`,
          payload: {
            userMessage: message.slice(0, 1000),
            assistantResponse: fullResponse.slice(0, 2000),
            responseLength: fullResponse.length,
            conversationId: conversationId || null,
          },
          metadata: { phase: 'response' },
        }).catch(() => {});

        // Save to daily notes — let extraction decide what's notable
        try {
          await extractAndSaveMemories(message, fullResponse, context);
        } catch (error) {
          console.error("Failed to save to daily notes:", error);
          // Don't fail the request if memory saving fails
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
