import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateBatchCard } from "@/lib/triage/batch-cards";
import { createRule } from "@/lib/triage/rules";

export async function POST(request: Request) {
  try {
    const { itemId, fromBatchType, toBatchType, sender, senderName, connector } =
      await request.json();

    if (!itemId || !fromBatchType || !toBatchType || !sender || !connector) {
      return NextResponse.json(
        { error: "Missing required fields: itemId, fromBatchType, toBatchType, sender, connector" },
        { status: 400 }
      );
    }

    if (fromBatchType === toBatchType) {
      return NextResponse.json(
        { error: "fromBatchType and toBatchType must be different" },
        { status: 400 }
      );
    }

    // 1. Get or create the target batch card
    const newCardId = await getOrCreateBatchCard(toBatchType);

    // 2. Update the item's classification JSONB
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, itemId))
      .limit(1);

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const existingClassification = (item.classification as Record<string, unknown>) || {};
    await db
      .update(inboxItems)
      .set({
        classification: {
          tier: "rule",
          confidence: 1,
          reason: `User reclassified from ${fromBatchType} to ${toBatchType}`,
          classifiedAt: new Date().toISOString(),
          ...existingClassification,
          batchType: toBatchType,
          batchCardId: newCardId,
        } as typeof item.classification,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, itemId));

    // 3. Create a structured triage rule
    const displayName = senderName || sender;
    const rule = await createRule({
      name: `Reclassify ${displayName} → ${toBatchType}`,
      type: "structured",
      source: "override",
      trigger: { sender },
      action: { type: "batch", batchType: toBatchType },
      description: `Auto-created when user reclassified item from ${fromBatchType} to ${toBatchType}`,
    });

    return NextResponse.json({
      success: true,
      ruleId: rule.id,
      newCardId,
    });
  } catch (error) {
    console.error("Reclassify failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
