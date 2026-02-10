/**
 * Conversation persistence — shared load/save logic for chat route and Telegram handler.
 */

import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Stored message shape persisted in the conversations table JSON column. */
export type StoredMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

/** Load conversation history from the database. Returns [] if not found. */
export async function loadConversation(
  conversationId: string
): Promise<StoredMessage[]> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (conv) {
    return (conv.messages as StoredMessage[]) || [];
  }
  return [];
}

/**
 * Save (upsert) conversation messages. Creates the conversation if it doesn't
 * exist, updates it otherwise.
 *
 * @returns The conversation ID (useful when creating a new conversation without a preset ID).
 */
export async function saveConversation(
  messages: StoredMessage[],
  conversationId?: string
): Promise<string> {
  if (conversationId) {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (existing) {
      await db
        .update(conversations)
        .set({ messages, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    } else {
      await db
        .insert(conversations)
        .values({ id: conversationId, messages });
    }
    return conversationId;
  }

  // No conversationId — create new
  const [newConv] = await db
    .insert(conversations)
    .values({ messages })
    .returning();
  return newConv.id;
}
