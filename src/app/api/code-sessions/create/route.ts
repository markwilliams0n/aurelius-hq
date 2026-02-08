import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createCard, generateCardId } from "@/lib/action-cards/db";
import { slugifyTask } from "@/lib/capabilities/code/prompts";
import { nanoid } from "nanoid";

/**
 * POST /api/code-sessions/create
 *
 * Creates a pending code session card directly (no chat needed).
 * Returns the card so the frontend can navigate to its detail page.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { task, context } = body;

    if (!task || typeof task !== "string" || !task.trim()) {
      return NextResponse.json(
        { error: "Task description is required" },
        { status: 400 },
      );
    }

    const sessionId = nanoid(12);
    const branchName = `aurelius/${slugifyTask(task)}`;
    const truncatedTask =
      task.length > 60 ? task.slice(0, 57) + "..." : task;

    const card = await createCard({
      id: generateCardId(),
      pattern: "code",
      handler: "code:start",
      status: "pending",
      title: `Coding: ${truncatedTask}`,
      data: {
        sessionId,
        task,
        context: context || null,
        branchName,
      },
    });

    return NextResponse.json({ card });
  } catch (error) {
    console.error("[code-sessions] Error creating session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
