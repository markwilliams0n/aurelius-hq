import { NextRequest, NextResponse } from "next/server";
import { getCostSummary, getRecentCosts } from "@/lib/triage/ai-cost";

// GET /api/triage/ai-costs?days=7
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") ?? "7", 10);

    const [summary, recent] = await Promise.all([
      getCostSummary(days),
      getRecentCosts(),
    ]);

    return NextResponse.json({ summary, recent });
  } catch (error) {
    console.error("[AI Costs API] Failed to fetch costs:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI costs" },
      { status: 500 }
    );
  }
}
