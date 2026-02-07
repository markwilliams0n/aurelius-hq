import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendDirectMessage, sendChannelMessage } from "@/lib/slack/actions";
import type { ActionCardStatus } from "@/lib/types/action-card";

// In-memory store for action card state (replace with DB when ready)
const actionCardStore = new Map<
  string,
  { status: ActionCardStatus; data?: Record<string, unknown>; resultUrl?: string }
>();

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

  let newStatus: ActionCardStatus;
  let resultUrl: string | undefined;

  switch (action) {
    case "send": {
      // Execute actual Slack send for slack_message cards
      const cardData = data as Record<string, unknown> | undefined;
      const recipientType = cardData?.recipientType as string | undefined;
      const recipientId = cardData?.recipientId as string | undefined;
      const message = cardData?.message as string | undefined;
      const myUserId = (cardData?.myUserId as string) || "";
      const threadTs = cardData?.threadTs as string | undefined;

      if (recipientType && recipientId && message) {
        try {
          const result = recipientType === "dm"
            ? await sendDirectMessage(recipientId, myUserId, message)
            : await sendChannelMessage(recipientId, myUserId, message, threadTs);

          if (result.ok) {
            newStatus = "sent";
            resultUrl = result.permalink;
          } else {
            console.error("[ActionCard] Slack send error:", result.error);
            newStatus = "error";
            return NextResponse.json({
              success: false,
              status: "error",
              error: result.error || "Slack send failed",
            });
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error("[ActionCard] Slack send failed:", errMsg);
          return NextResponse.json({
            success: false,
            status: "error",
            error: errMsg,
          });
        }
      } else if (!recipientType && !recipientId) {
        // Non-Slack card — just mark as sent
        newStatus = "sent";
      } else {
        // Slack card but missing required data
        return NextResponse.json({
          success: false,
          status: "error",
          error: "Missing required fields: recipientId or message",
        });
      }
      break;
    }
    case "confirm":
      newStatus = "confirmed";
      break;
    case "cancel":
      newStatus = "canceled";
      break;
    case "edit":
      newStatus = "pending";
      break;
    default:
      newStatus = "confirmed";
      break;
  }

  actionCardStore.set(id, {
    status: newStatus,
    data: data ?? undefined,
    resultUrl,
  });

  return NextResponse.json({
    success: true,
    status: newStatus,
    resultUrl,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const stored = actionCardStore.get(id);

  if (!stored) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(stored);
}
