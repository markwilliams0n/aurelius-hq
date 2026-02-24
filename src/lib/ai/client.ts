import { OpenRouter } from "@openrouter/sdk";
import { getAllTools, handleToolCall } from "@/lib/capabilities";

// OpenRouter client singleton
export const ai = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Message type for conversations
export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Message with tool calls (for internal use)
type MessageWithTools = Message | {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
} | {
  role: "tool";
  content: string;
  tool_call_id: string;
};

// Default model - exported so it can be referenced in prompts
export const DEFAULT_MODEL =
  process.env.OPENROUTER_DEFAULT_MODEL || "moonshotai/kimi-k2.5";

// Model for tool use - same as default unless overridden
const TOOL_MODEL = process.env.OPENROUTER_TOOL_MODEL || DEFAULT_MODEL;

// Tool call iterations before asking permission to continue
const TOOL_ITERATION_CHECKPOINT = 25;

// API request timeout in milliseconds
const API_TIMEOUT_MS = 30000;

// Simple chat completion
export async function chat(
  input: string | Message[],
  instructions?: string,
  options?: { maxTokens?: number; timeoutMs?: number }
): Promise<string> {
  return chatWithModel(DEFAULT_MODEL, input, instructions, options);
}

// Chat with a specific model (for tasks that need a different model than default)
export async function chatWithModel(
  model: string,
  input: string | Message[],
  instructions?: string,
  options?: { maxTokens?: number; timeoutMs?: number }
): Promise<string> {
  const result = ai.callModel({
    model,
    input,
    instructions,
    maxOutputTokens: options?.maxTokens ?? 4096,
  });
  return Promise.race([
    result.getText(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OpenRouter chat timed out")), options?.timeoutMs ?? API_TIMEOUT_MS)
    ),
  ]);
}

// Result type for streaming
export type ChatStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: string }
  | { type: "pending_change"; changeId: string }
  | { type: "action_card"; card: { pattern: string; title: string; data: Record<string, unknown>; handler?: string } };

// Streaming chat completion with tool support (multi-turn)
export async function* chatStreamWithTools(
  input: string | Message[],
  instructions?: string,
  conversationId?: string
): AsyncGenerator<ChatStreamEvent> {
  const messages = typeof input === "string"
    ? [{ role: "user" as const, content: input }]
    : input;

  // Build conversation messages with tool history
  let conversationMessages: MessageWithTools[] = [
    { role: "system", content: instructions || "" },
    ...messages,
  ];

  let iterations = 0;

  // Loop to handle multiple tool calls (no hard limit — checkpoints ask permission)
  while (true) {
    iterations++;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response: Response;
    try {
      const toolDefs = getAllTools();
      const requestBody = {
        model: TOOL_MODEL,
        messages: conversationMessages,
        tools: toolDefs,
        tool_choice: "auto",
      };

      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      console.error("[AI Client] Request failed:", error);
      yield* streamWithoutTools(messages, instructions);
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      console.error("[AI Client] API error:", error);
      yield* streamWithoutTools(messages, instructions);
      return;
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    const message = choice?.message;
    const toolCalls = message?.tool_calls;

    console.log("[AI Client] Response:", JSON.stringify({
      iteration: iterations,
      finishReason: choice?.finish_reason,
      hasToolCalls: !!toolCalls,
      toolCalls: toolCalls?.map((t: { function?: { name?: string } }) => t.function?.name),
      contentPreview: message?.content?.slice(0, 50),
    }));

    // If no tool calls, we're done - output the text content
    if (!toolCalls || toolCalls.length === 0) {
      if (message?.content) {
        yield { type: "text", content: message.content };
      }
      return;
    }

    // Process tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      const toolArgs = toolCall.function?.arguments;
      const toolId = toolCall.id;

      // Validate required fields
      if (!toolName || !toolId) {
        console.warn("[AI Client] Tool call missing name or id, skipping");
        continue;
      }

      // Parse args once and reuse
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(toolArgs || "{}");
      } catch (parseError) {
        console.error("[AI Client] Failed to parse tool args:", parseError);
        continue;
      }

      yield { type: "tool_use", toolName, toolInput: parsedArgs };

      try {
        const { result: toolResult, pendingChangeId, actionCard } = await handleToolCall(
          toolName,
          parsedArgs,
          conversationId
        );

        yield { type: "tool_result", toolName, result: toolResult };
        console.log("[AI Client] Tool executed:", toolName);

        if (pendingChangeId) {
          console.log("[AI Client] Pending change created:", pendingChangeId);
          yield { type: "pending_change", changeId: pendingChangeId };
        }

        if (actionCard) {
          yield { type: "action_card", card: actionCard };
        }

        // Add assistant message with tool call and tool result to conversation
        conversationMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: toolId,
            type: "function",
            function: { name: toolName, arguments: toolArgs || "{}" },
          }],
        });
        conversationMessages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: toolId,
        });

      } catch (error) {
        console.error("[AI Client] Tool error:", error);
        yield { type: "tool_result", toolName, result: JSON.stringify({ error: String(error) }) };
      }
    }

    // Checkpoint: after N iterations, inject a nudge asking the model to pause
    if (iterations > 0 && iterations % TOOL_ITERATION_CHECKPOINT === 0) {
      console.log(`[AI Client] Checkpoint at ${iterations} iterations — injecting pause prompt`);
      conversationMessages.push({
        role: "user",
        content: `You've made ${iterations} tool calls. Pause here and summarize what you've done so far and what's left. Ask the user if they'd like you to continue.`,
      });
    }

    // Continue loop to see if AI wants to call more tools
  }
}

// Fallback streaming without tools
async function* streamWithoutTools(
  messages: Message[],
  instructions?: string
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: instructions || "" },
        ...messages,
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "text", content: delta.content };
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// Legacy streaming function (alias for backwards compatibility)
export async function* chatStream(
  input: string | Message[],
  instructions?: string
): AsyncGenerator<string> {
  const result = ai.callModel({
    model: DEFAULT_MODEL,
    input,
    instructions,
  });
  for await (const delta of result.getTextStream()) {
    yield delta;
  }
}
