import { OpenRouter } from "@openrouter/sdk";

// OpenRouter client singleton
export const ai = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Message type for conversations
export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
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
export type ChatStreamEvent = { type: "text"; content: string };

// Streaming chat completion
// Note: Memory is now handled post-response via file writes, not via tools
export async function* chatStreamWithTools(
  input: string | Message[],
  instructions?: string,
  _conversationId?: string  // kept for API compatibility, not used
): AsyncGenerator<ChatStreamEvent> {
  const result = ai.callModel({
    model: DEFAULT_MODEL,
    input,
    instructions,
  });

  let streamedText = "";
  for await (const delta of result.getTextStream()) {
    streamedText += delta;
    yield { type: "text", content: delta };
  }

  // If nothing was streamed, get the full text
  if (!streamedText) {
    const fullText = await result.getText();
    if (fullText) {
      yield { type: "text", content: fullText };
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
