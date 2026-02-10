import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { chatStreamWithTools, DEFAULT_MODEL, type Message } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { extractAndSaveMemories } from "@/lib/memory/extraction";
import { emitMemoryEvent } from "@/lib/memory/events";
import { loadConversation, saveConversation, type StoredMessage } from "@/lib/conversation/persistence";
import { createCard, generateCardId } from "@/lib/action-cards/db";
import { sseEncode, SSE_HEADERS } from "@/lib/sse/server";
import type { CardPattern } from "@/lib/types/action-card";
import type { ChatContext } from "@/lib/types/chat-context";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const storedHistory = conversationId
    ? await loadConversation(conversationId)
    : [];

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
          sseEncode({ type: "assistant_message_id", id: assistantMessageId })
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
              sseEncode({ type: "text", content: event.content })
            );
          } else if (event.type === "tool_use") {
            controller.enqueue(
              sseEncode({ type: "tool_use", toolName: event.toolName, toolInput: event.toolInput })
            );
          } else if (event.type === "tool_result") {
            controller.enqueue(
              sseEncode({ type: "tool_result", toolName: event.toolName, result: event.result })
            );
          } else if (event.type === "action_card") {
            const ac = event.card;
            const cardId = generateCardId();
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
              sseEncode({ type: "action_card", card })
            );
          } else if (event.type === "pending_change") {
            pendingChangeId = event.changeId;
            controller.enqueue(
              sseEncode({ type: "pending_change", changeId: event.changeId })
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

        const savedId = await saveConversation(newStoredMessages, conversationId);
        if (!conversationId) {
          controller.enqueue(
            sseEncode({ type: "conversation", id: savedId })
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
          sseEncode({ type: "stats", model: DEFAULT_MODEL, tokenCount: estimatedTokens })
        );

        // Send done event
        controller.enqueue(sseEncode({ type: "done" }));
        controller.close();
      } catch (error) {
        console.error("Chat error:", error);
        controller.enqueue(
          sseEncode({ type: "error", message: "Chat failed" })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
