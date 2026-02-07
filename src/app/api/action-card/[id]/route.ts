import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCard, updateCard } from "@/lib/action-cards/db";
import { sendDirectMessage, sendChannelMessage, type SendAs } from "@/lib/slack/actions";
import type { CardStatus } from "@/lib/types/action-card";

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

  // Load card from DB
  const card = await getCard(id);

  // Generic status-only actions
  if (action === "cancel" || action === "dismiss") {
    const updated = await updateCard(id, { status: "dismissed" });
    return NextResponse.json({ success: true, status: "dismissed", result: updated?.result });
  }
  if (action === "edit") {
    if (data) await updateCard(id, { status: "pending", data });
    else await updateCard(id, { status: "pending" });
    return NextResponse.json({ success: true, status: "pending" });
  }

  // Primary action — dispatch based on handler
  const handler = card?.handler ?? (data as Record<string, unknown> | undefined)?.handler;

  // Slack send handler (temporary — will be extracted to registry in PER-165)
  if (handler === "slack:send-message" || (!handler && data?.recipientType)) {
    const cardData = data as Record<string, unknown> | undefined;
    const recipientType = cardData?.recipientType as string | undefined;
    const recipientId = cardData?.recipientId as string | undefined;
    const message = cardData?.message as string | undefined;
    const myUserId = (cardData?.myUserId as string) || "";
    const threadTs = cardData?.threadTs as string | undefined;
    const sendAs = (cardData?.sendAs as SendAs) || "bot";

    if (!recipientType || !recipientId || !message) {
      const errorResult = { error: "Missing required fields: recipientId or message" };
      await updateCard(id, { status: "error", result: errorResult });
      return NextResponse.json({ success: false, status: "error", result: errorResult });
    }

    try {
      const slackResult = recipientType === "dm"
        ? await sendDirectMessage(recipientId, myUserId, message, sendAs)
        : await sendChannelMessage(recipientId, myUserId, message, threadTs, sendAs);

      if (slackResult.ok) {
        const result = { resultUrl: slackResult.permalink };
        await updateCard(id, { status: "confirmed", result });
        return NextResponse.json({ success: true, status: "confirmed", result, successMessage: "Slack message sent!" });
      } else {
        const errorResult = { error: slackResult.error || "Slack send failed" };
        await updateCard(id, { status: "error", result: errorResult });
        return NextResponse.json({ success: false, status: "error", result: errorResult });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errorResult = { error: errMsg };
      await updateCard(id, { status: "error", result: errorResult });
      return NextResponse.json({ success: false, status: "error", result: errorResult });
    }
  }

  // Default: just mark as confirmed
  const updated = await updateCard(id, { status: "confirmed" });
  return NextResponse.json({ success: true, status: "confirmed", result: updated?.result });
}
