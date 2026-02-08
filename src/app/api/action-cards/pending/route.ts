import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPendingCards } from "@/lib/action-cards/db";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cards = await getPendingCards();
    return NextResponse.json({ cards });
  } catch (error) {
    console.error("[Action Cards] Error fetching pending cards:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
