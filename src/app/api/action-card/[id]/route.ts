import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCard, updateCard } from "@/lib/action-cards/db";
import { dispatchCardAction } from "@/lib/action-cards/registry";

// Auto-register handlers on import
import "@/lib/action-cards/handlers/slack";
import "@/lib/action-cards/handlers/gmail";
import "@/lib/action-cards/handlers/linear";
import "@/lib/action-cards/handlers/config";
import "@/lib/action-cards/handlers/vault";
import "@/lib/action-cards/handlers/code";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { action, data } = await request.json();

    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    // Load card from DB to get handler info
    const card = await getCard(id);
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    // Update card data if provided (e.g. inline edits before send)
    if (data && action !== "cancel" && action !== "dismiss") {
      await updateCard(id, { data });
    }

    // Dispatch action through registry
    const cardData = data ?? card.data ?? {};
    const result = await dispatchCardAction(card.handler, action, cardData);

    // If confirmation needed, return without persisting status
    if (result.status === "needs_confirmation") {
      return NextResponse.json({
        success: true,
        status: "needs_confirmation",
        confirmMessage: result.confirmMessage,
      });
    }

    // Persist status + result to DB
    await updateCard(id, {
      status: result.status,
      ...(result.result && { result: result.result }),
    });

    return NextResponse.json({
      success: result.status !== "error",
      status: result.status,
      result: result.result,
      successMessage: result.successMessage,
    });
  } catch (error) {
    console.error("[Action Card] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
