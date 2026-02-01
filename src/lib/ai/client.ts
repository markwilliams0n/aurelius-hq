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

// Default model
const DEFAULT_MODEL =
  process.env.OPENROUTER_DEFAULT_MODEL || "moonshotai/kimi-k2-0711-preview";

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

// Streaming chat completion
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
