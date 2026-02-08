import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCard, updateCard } from "@/lib/action-cards/db";
import { getActiveSessions } from "@/lib/action-cards/handlers/code";

/**
 * POST /api/code-sessions/[id]/respond
 *
 * Sends a user message to a running bidirectional coding session.
 * The session must be in "waiting_for_input" state.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: cardId } = await params;
    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // Look up the card to get the sessionId
    const card = await getCard(cardId);
    if (!card) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const data = card.data as Record<string, unknown>;
    const sessionId = data.sessionId as string | undefined;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Card has no sessionId" },
        { status: 400 },
      );
    }

    // Find the active session
    const activeSessions = getActiveSessions();
    const activeSession = activeSessions.get(sessionId);

    if (!activeSession) {
      return NextResponse.json(
        { error: "No active session — it may have completed or been stopped" },
        { status: 409 },
      );
    }

    if (activeSession.state !== "waiting_for_input") {
      return NextResponse.json(
        { error: `Session is ${activeSession.state}, not waiting for input` },
        { status: 409 },
      );
    }

    // Send the message
    activeSession.sendMessage(message.trim());

    // Update card state to running
    await updateCard(cardId, {
      data: {
        ...data,
        state: "running",
        lastMessage: undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[code-sessions] Error sending respond:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
