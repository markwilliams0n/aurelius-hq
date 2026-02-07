import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCard, updateCard } from "@/lib/action-cards/db";
import { dispatchCardAction } from "@/lib/action-cards/registry";

// Auto-register handlers on import
import "@/lib/action-cards/handlers/slack";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const handler = card?.handler ?? null;

  // Update card data if provided (e.g. inline edits before send)
  if (data && action !== "cancel" && action !== "dismiss") {
    await updateCard(id, { data });
  }

  // Dispatch action through registry
  const cardData = data ?? card?.data ?? {};
  const result = await dispatchCardAction(handler, action, cardData);

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
}
