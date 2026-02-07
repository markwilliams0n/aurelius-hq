import { db } from "@/lib/db";
import { actionCards } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ActionCardData, CardStatus } from "@/lib/types/action-card";
import type { NewActionCard } from "@/lib/db/schema/action-cards";

/**
 * Generate a card ID.
 */
export function generateCardId(): string {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a new action card in the database.
 */
export async function createCard(
  card: Omit<NewActionCard, "createdAt" | "updatedAt">
): Promise<ActionCardData> {
  const [row] = await db.insert(actionCards).values(card).returning();
  return rowToCardData(row);
}

/**
 * Get a card by ID.
 */
export async function getCard(id: string): Promise<ActionCardData | null> {
  const [row] = await db
    .select()
    .from(actionCards)
    .where(eq(actionCards.id, id))
    .limit(1);

  return row ? rowToCardData(row) : null;
}

/**
 * Update a card's status and optionally its result.
 */
export async function updateCard(
  id: string,
  updates: {
    status?: CardStatus;
    data?: Record<string, unknown>;
    result?: Record<string, unknown>;
  }
): Promise<ActionCardData | null> {
  const [row] = await db
    .update(actionCards)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(actionCards.id, id))
    .returning();

  return row ? rowToCardData(row) : null;
}

/**
 * Get all cards for a conversation, ordered by creation time.
 */
export async function getCardsByConversation(
  conversationId: string
): Promise<ActionCardData[]> {
  const rows = await db
    .select()
    .from(actionCards)
    .where(eq(actionCards.conversationId, conversationId))
    .orderBy(actionCards.createdAt);

  return rows.map(rowToCardData);
}

/**
 * Get all pending cards (for notification tray, dashboards, etc.)
 */
export async function getPendingCards(): Promise<ActionCardData[]> {
  const rows = await db
    .select()
    .from(actionCards)
    .where(eq(actionCards.status, "pending"))
    .orderBy(desc(actionCards.createdAt));

  return rows.map(rowToCardData);
}

/**
 * Convert a DB row to the client-facing ActionCardData shape.
 */
function rowToCardData(row: typeof actionCards.$inferSelect): ActionCardData {
  return {
    id: row.id,
    messageId: row.messageId ?? undefined,
    conversationId: row.conversationId ?? undefined,
    pattern: row.pattern,
    status: row.status,
    title: row.title,
    data: row.data,
    handler: row.handler,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
