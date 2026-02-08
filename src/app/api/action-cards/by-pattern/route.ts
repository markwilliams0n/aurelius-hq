import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCardsByPattern } from "@/lib/action-cards/db";
import type { CardPattern } from "@/lib/types/action-card";

const VALID_PATTERNS = new Set<CardPattern>([
  "approval", "code", "config", "confirmation", "info", "vault",
]);

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pattern = searchParams.get("pattern") as CardPattern | null;

    if (!pattern || !VALID_PATTERNS.has(pattern)) {
      return NextResponse.json(
        { error: "Missing or invalid pattern parameter" },
        { status: 400 },
      );
    }

    const cards = await getCardsByPattern(pattern);
    return NextResponse.json({ cards });
  } catch (error) {
    console.error("[Action Cards] Error fetching cards by pattern:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
