/**
 * Conversation history trimming — sliding window to prevent unbounded context growth.
 */

import type { Message } from "@/lib/ai/client";

/** Rough character-to-token ratio (~4 chars per token for English) */
const CHARS_PER_TOKEN = 4;

/**
 * Trim conversation history to fit within a token budget.
 * Drops the oldest message pairs first, always keeping at least the
 * most recent user message.
 *
 * @param messages - Conversation messages (user/assistant alternating)
 * @param maxTokens - Maximum token budget for history (default 8000)
 */
export function trimHistory(
  messages: Message[],
  maxTokens: number = 8000
): Message[] {
  if (messages.length === 0) return messages;

  const estimateTokens = (msgs: Message[]) =>
    Math.ceil(
      msgs.reduce((sum, m) => sum + m.content.length, 0) / CHARS_PER_TOKEN
    );

  // If within budget, return as-is
  if (estimateTokens(messages) <= maxTokens) return messages;

  // Always keep at least the last message
  let startIdx = 0;

  // Drop from the front in pairs (user+assistant) until within budget
  while (startIdx < messages.length - 1) {
    const remaining = messages.slice(startIdx);
    if (estimateTokens(remaining) <= maxTokens) break;

    // Skip forward by 2 (one pair) if possible
    if (startIdx + 2 <= messages.length - 1) {
      startIdx += 2;
    } else {
      startIdx += 1;
    }
  }

  const trimmed = messages.slice(startIdx);

  // Ensure first message is from "user" (don't leave orphaned assistant)
  if (trimmed.length > 0 && trimmed[0].role === "assistant") {
    return trimmed.slice(1);
  }

  return trimmed;
}
