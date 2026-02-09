import { db } from "@/lib/db";
import { actionCards, inboxItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateCardId } from "@/lib/action-cards/db";

// ── Default configs per batch type ──────────────────────────────────────────

const BATCH_CONFIGS: Record<string, { title: string; explanation: string }> = {
  archive: {
    title: "Archive these",
    explanation:
      "Routine notifications and messages that don't need your attention.",
  },
  "note-archive": {
    title: "Note & archive",
    explanation: "Worth knowing about but no action needed.",
  },
  spam: {
    title: "Likely spam",
    explanation: "These look like spam or unsolicited marketing.",
  },
  attention: {
    title: "Quick review",
    explanation: "These need attention but can be reviewed as a group.",
  },
};

function getConfigForBatchType(batchType: string) {
  return (
    BATCH_CONFIGS[batchType] ?? {
      title: batchType,
      explanation: `Grouped items: ${batchType}`,
    }
  );
}

// ── Get or create a pending batch card for a batch type ─────────────────────

/**
 * Look for an existing pending batch card matching this batchType.
 * If none exists, create one. Returns the card ID.
 */
export async function getOrCreateBatchCard(
  batchType: string
): Promise<string> {
  // Look for existing pending batch card with matching batchType
  const [existing] = await db
    .select({ id: actionCards.id })
    .from(actionCards)
    .where(
      and(
        eq(actionCards.pattern, "batch"),
        eq(actionCards.status, "pending"),
        sql`${actionCards.data}->>'batchType' = ${batchType}`
      )
    )
    .limit(1);

  if (existing) {
    return existing.id;
  }

  // Create a new batch card
  const config = getConfigForBatchType(batchType);
  const id = generateCardId();

  await db.insert(actionCards).values({
    id,
    pattern: "batch",
    status: "pending",
    title: config.title,
    handler: "batch:action",
    data: {
      batchType,
      action: "archive",
      explanation: config.explanation,
      itemCount: 0,
    },
  });

  return id;
}

// ── Assign classified items to batch cards ──────────────────────────────────

/**
 * Find items that have been classified with a batchType but not yet assigned
 * to a batch card. Group by batchType, create/get cards, and assign.
 */
export async function assignItemsToBatchCards(): Promise<{
  assigned: number;
  cards: Record<string, number>;
}> {
  // Find items with classification that have a batchType but no batchCardId
  const unassigned = await db
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.status, "new"),
        sql`${inboxItems.classification} IS NOT NULL`,
        sql`${inboxItems.classification}->>'batchCardId' IS NULL`,
        sql`${inboxItems.classification}->>'batchType' IS NOT NULL`
      )
    );

  if (unassigned.length === 0) {
    return { assigned: 0, cards: {} };
  }

  // Group by batchType
  const groups: Record<string, typeof unassigned> = {};
  for (const item of unassigned) {
    const batchType = (item.classification as Record<string, unknown>)
      ?.batchType as string;
    if (!batchType) continue;
    if (!groups[batchType]) groups[batchType] = [];
    groups[batchType].push(item);
  }

  let totalAssigned = 0;
  const cards: Record<string, number> = {};

  for (const [batchType, items] of Object.entries(groups)) {
    const cardId = await getOrCreateBatchCard(batchType);

    // Update each item's classification with the batchCardId
    for (const item of items) {
      const existingClassification = item.classification as Record<
        string,
        unknown
      >;
      await db
        .update(inboxItems)
        .set({
          classification: {
            ...existingClassification,
            batchCardId: cardId,
          } as typeof item.classification,
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, item.id));
    }

    // Update the card's itemCount
    const [card] = await db
      .select({ data: actionCards.data })
      .from(actionCards)
      .where(eq(actionCards.id, cardId))
      .limit(1);

    if (card) {
      const cardData = card.data as Record<string, unknown>;
      await db
        .update(actionCards)
        .set({
          data: {
            ...cardData,
            itemCount: items.length + ((cardData.itemCount as number) || 0),
          },
          updatedAt: new Date(),
        })
        .where(eq(actionCards.id, cardId));
    }

    totalAssigned += items.length;
    cards[batchType] = items.length;
  }

  return { assigned: totalAssigned, cards };
}

// ── Get batch cards with their items ────────────────────────────────────────

export interface BatchCardWithItems {
  id: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    externalId: string | null;
    connector: string;
    sender: string;
    senderName: string | null;
    subject: string;
    summary?: string;
    tier: string;
    confidence: number;
  }>;
}

/**
 * Get all pending batch cards with their associated inbox items.
 * Filters out cards with no remaining "new" items.
 */
export async function getBatchCardsWithItems(): Promise<BatchCardWithItems[]> {
  // Get all pending batch cards
  const pendingCards = await db
    .select()
    .from(actionCards)
    .where(
      and(eq(actionCards.pattern, "batch"), eq(actionCards.status, "pending"))
    );

  if (pendingCards.length === 0) {
    return [];
  }

  const result: BatchCardWithItems[] = [];

  for (const card of pendingCards) {
    // Fetch items assigned to this card that are still "new"
    const items = await db
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.status, "new"),
          sql`${inboxItems.classification}->>'batchCardId' = ${card.id}`
        )
      );

    // Skip cards with no items
    if (items.length === 0) continue;

    result.push({
      id: card.id,
      title: card.title,
      status: card.status,
      data: card.data as Record<string, unknown>,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
      items: items.map((item) => {
        const classification = item.classification as Record<
          string,
          unknown
        > | null;
        const enrichment = item.enrichment as Record<string, unknown> | null;
        return {
          id: item.id,
          externalId: item.externalId,
          connector: item.connector,
          sender: item.sender,
          senderName: item.senderName,
          subject: item.subject,
          summary: (enrichment?.summary as string) ?? undefined,
          tier: (classification?.tier as string) ?? "unknown",
          confidence: (classification?.confidence as number) ?? 0,
        };
      }),
    });
  }

  return result;
}

// ── Action a batch card ─────────────────────────────────────────────────────

/**
 * Process a batch card action:
 * - Checked items: apply the card's action (e.g. archive)
 * - Unchecked items: clear classification so they appear individually
 * - Mark card as confirmed
 */
export async function actionBatchCard(
  cardId: string,
  checkedItemIds: string[],
  uncheckedItemIds: string[]
): Promise<void> {
  // Get the card to read its action
  const [card] = await db
    .select()
    .from(actionCards)
    .where(eq(actionCards.id, cardId))
    .limit(1);

  if (!card) {
    throw new Error(`Batch card not found: ${cardId}`);
  }

  const cardData = card.data as Record<string, unknown>;
  const action = (cardData.action as string) || "archive";

  // Process checked items — apply the action
  if (checkedItemIds.length > 0) {
    for (const itemId of checkedItemIds) {
      if (action === "archive") {
        await db
          .update(inboxItems)
          .set({
            status: "archived",
            updatedAt: new Date(),
          })
          .where(eq(inboxItems.id, itemId));
      }
    }
  }

  // Process unchecked items — clear classification
  if (uncheckedItemIds.length > 0) {
    for (const itemId of uncheckedItemIds) {
      await db
        .update(inboxItems)
        .set({
          classification: null,
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, itemId));
    }
  }

  // Mark the card as confirmed
  await db
    .update(actionCards)
    .set({
      status: "confirmed",
      result: {
        checkedCount: checkedItemIds.length,
        uncheckedCount: uncheckedItemIds.length,
        action,
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(actionCards.id, cardId));
}
