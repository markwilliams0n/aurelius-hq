import { OpenRouter } from "@openrouter/sdk";
import { CONFIG_TOOLS, handleConfigTool, isConfigTool } from "./config-tools";

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
  process.env.OPENROUTER_DEFAULT_MODEL || "moonshotai/kimi-k2";

// Model that supports tool use (Claude is reliable for this)
const TOOL_MODEL = "anthropic/claude-sonnet-4";

// Simple chat completion
export async function chat(
  input: string | Message[],
  instructions?: string
): Promise<string> {
  const result = ai.callModel({
    model: DEFAULT_MODEL,
    input,
    instructions,
  });
  return result.getText();
}

// Result type for streaming
export type ChatStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; result: string }
  | { type: "pending_change"; changeId: string };

// Streaming chat completion with tool support
export async function* chatStreamWithTools(
  input: string | Message[],
  instructions?: string,
  conversationId?: string
): AsyncGenerator<ChatStreamEvent> {
  const messages = typeof input === "string"
    ? [{ role: "user" as const, content: input }]
    : input;

  // First, make a non-streaming call to check if tools are needed
  // Use a model that reliably supports tools
  const toolCheckResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model: TOOL_MODEL,
      messages: [
        { role: "system", content: instructions || "" },
        ...messages,
      ],
      tools: CONFIG_TOOLS.map(t => ({
        type: "function",
        function: t,
      })),
      tool_choice: "auto",
    }),
  });

  if (!toolCheckResponse.ok) {
    const error = await toolCheckResponse.text();
    console.error("OpenRouter tool check error:", error);
    // Fall back to regular streaming without tools
    yield* streamWithoutTools(messages, instructions);
    return;
  }

  const toolCheckResult = await toolCheckResponse.json();
  const choice = toolCheckResult.choices?.[0];
  const toolCalls = choice?.message?.tool_calls;

  // If there are tool calls, process them
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      const toolArgs = toolCall.function?.arguments;

      if (toolName) {
        yield { type: "tool_use", toolName, toolInput: JSON.parse(toolArgs || "{}") };

        // Execute the tool
        try {
          const { result, pendingChangeId } = await handleConfigTool(
            toolName,
            JSON.parse(toolArgs || "{}"),
            conversationId
          );

          yield { type: "tool_result", result };

          if (pendingChangeId) {
            yield { type: "pending_change", changeId: pendingChangeId };
          }

          // Continue the conversation with tool result - stream this part
          const continueMessages: MessageWithTools[] = [
            { role: "system", content: instructions || "" },
            ...messages,
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: toolCall.id,
                type: "function",
                function: { name: toolName, arguments: toolArgs },
              }],
            },
            {
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            },
          ];

          // Stream the follow-up response
          const followUp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
            },
            body: JSON.stringify({
              model: TOOL_MODEL,
              messages: continueMessages,
              stream: true,
            }),
          });

          if (followUp.ok) {
            const reader = followUp.body?.getReader();
            if (reader) {
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
          }
        } catch (error) {
          console.error("Tool execution error:", error);
          yield { type: "tool_result", result: JSON.stringify({ error: String(error) }) };
        }
      }
    }
  } else {
    // No tool calls - just output the text response
    const textContent = choice?.message?.content;
    if (textContent) {
      yield { type: "text", content: textContent };
    }
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
