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

  // Use fetch directly for tool support since the SDK may not fully support it
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
      tools: CONFIG_TOOLS.map(t => ({
        type: "function",
        function: t,
      })),
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("OpenRouter error:", error);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentToolCall: { id: string; name: string; arguments: string } | null = null;

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

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              currentToolCall = { id: tc.id || `tool_${Date.now()}`, name: tc.function.name, arguments: "" };
            }
            if (currentToolCall && tc.function?.arguments) {
              currentToolCall.arguments += tc.function.arguments;
            }
          }
        }

        // Check if we have a complete tool call at finish
        const finishReason = json.choices?.[0]?.finish_reason;
        if (finishReason === "tool_calls" && currentToolCall) {
          yield { type: "tool_use", toolName: currentToolCall.name, toolInput: JSON.parse(currentToolCall.arguments || "{}") };

          // Execute the tool
          const toolInput = JSON.parse(currentToolCall.arguments || "{}");
          const { result, pendingChangeId } = await handleConfigTool(
            currentToolCall.name,
            toolInput,
            conversationId
          );

          yield { type: "tool_result", result };

          if (pendingChangeId) {
            yield { type: "pending_change", changeId: pendingChangeId };
          }

          // Continue the conversation with tool result
          const continueMessages: MessageWithTools[] = [
            { role: "system", content: instructions || "" },
            ...messages,
            {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: currentToolCall.id,
                type: "function",
                function: { name: currentToolCall.name, arguments: currentToolCall.arguments },
              }],
            },
            {
              role: "tool",
              content: result,
              tool_call_id: currentToolCall.id,
            },
          ];

          // Get the assistant's follow-up response
          const followUp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: DEFAULT_MODEL,
              messages: continueMessages,
              stream: true,
            }),
          });

          const followUpReader = followUp.body?.getReader();
          if (followUpReader) {
            let followUpBuffer = "";
            while (true) {
              const { done: fDone, value: fValue } = await followUpReader.read();
              if (fDone) break;

              followUpBuffer += decoder.decode(fValue, { stream: true });
              const fLines = followUpBuffer.split("\n");
              followUpBuffer = fLines.pop() || "";

              for (const fLine of fLines) {
                if (!fLine.startsWith("data: ")) continue;
                const fData = fLine.slice(6);
                if (fData === "[DONE]") continue;

                try {
                  const fJson = JSON.parse(fData);
                  const fDelta = fJson.choices?.[0]?.delta;
                  if (fDelta?.content) {
                    yield { type: "text", content: fDelta.content };
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }

          currentToolCall = null;
        }
      } catch {
        // Skip malformed JSON chunks
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
