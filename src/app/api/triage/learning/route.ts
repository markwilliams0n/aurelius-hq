import { NextResponse } from "next/server";
import { runDailyLearning } from "@/lib/triage/daily-learning";

export async function POST() {
  try {
    const result = await runDailyLearning();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Daily learning failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
