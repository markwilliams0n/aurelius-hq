import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCard } from "@/lib/action-cards/db";
import { readFileSync, existsSync } from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs", "code-sessions");

/**
 * GET /api/code-sessions/[id]/progress?after=0
 *
 * Returns log lines for a coding session (read from the log file)
 * plus the current card status. Used for live progress polling.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const card = await getCard(id);
    if (!card) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const data = card.data as Record<string, unknown>;
    const sessionId = data.sessionId as string | undefined;

    let lines: string[] = [];
    let totalLines = 0;

    if (sessionId) {
      const logPath = path.join(LOG_DIR, `${sessionId}.log`);
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8");
        const allLines = content.split("\n").filter(Boolean);
        totalLines = allLines.length;

        const { searchParams } = new URL(request.url);
        const after = parseInt(searchParams.get("after") || "0", 10);
        lines = allLines.slice(after);
      }
    }

    return NextResponse.json({
      lines,
      totalLines,
      card: {
        id: card.id,
        status: card.status,
        title: card.title,
        data: card.data,
        result: card.result,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
    });
  } catch (error) {
    console.error("[code-sessions] Error fetching progress:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
