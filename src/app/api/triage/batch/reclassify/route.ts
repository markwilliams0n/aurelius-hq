import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateBatchCard } from "@/lib/triage/batch-cards";
import { createRule, updateRule, findExistingRuleBySender } from "@/lib/triage/rules";

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

    const VALID_BATCH_TYPES = ["notifications", "finance", "newsletters", "calendar", "spam"];
    const isRemoveFromGroup = toBatchType === "individual";

    if (!isRemoveFromGroup && !VALID_BATCH_TYPES.includes(toBatchType)) {
      return NextResponse.json(
        { error: "Invalid batchType" },
        { status: 400 }
      );
    }

    // Look up the item
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, itemId))
      .limit(1);

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const existingClassification = (item.classification as Record<string, unknown>) || {};

    // Remove from group → clear batch assignment, keep as individual
    if (isRemoveFromGroup) {
      await db
        .update(inboxItems)
        .set({
          classification: {
            ...existingClassification,
            tier: "rule" as const,
            confidence: 1,
            reason: `User removed from ${fromBatchType} group`,
            classifiedAt: new Date().toISOString(),
            batchType: null,
            batchCardId: null,
          },
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, itemId));

      return NextResponse.json({ success: true });
    }

    // Move to a different group
    const newCardId = await getOrCreateBatchCard(toBatchType);
    const isFromIndividual = fromBatchType === "individual";
    await db
      .update(inboxItems)
      .set({
        classification: {
          ...existingClassification,
          tier: "rule",
          confidence: 1,
          reason: `User reclassified from ${fromBatchType} to ${toBatchType}`,
          classifiedAt: new Date().toISOString(),
          batchType: toBatchType,
          batchCardId: newCardId,
        } as typeof item.classification,
        // Archive the item when classifying from individual triage
        ...(isFromIndividual ? { status: "archived" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, itemId));

    // Dedup: check for existing active rule matching this sender
    const displayName = senderName || sender;
    const existingRule = await findExistingRuleBySender(sender);

    let ruleId: string;
    if (existingRule) {
      // Update existing rule's action instead of creating a duplicate
      const updated = await updateRule(existingRule.id, {
        action: { type: "batch", batchType: toBatchType },
        name: `Reclassify ${displayName} → ${toBatchType}`,
        description: `Updated when user reclassified item from ${fromBatchType} to ${toBatchType}`,
      });
      ruleId = updated!.id;
    } else {
      // Create new rule
      const rule = await createRule({
        name: `Reclassify ${displayName} → ${toBatchType}`,
        type: "structured",
        source: "override",
        trigger: { sender },
        action: { type: "batch", batchType: toBatchType },
        description: `Auto-created when user reclassified item from ${fromBatchType} to ${toBatchType}`,
      });
      ruleId = rule.id;
    }

    return NextResponse.json({
      success: true,
      ruleId,
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
