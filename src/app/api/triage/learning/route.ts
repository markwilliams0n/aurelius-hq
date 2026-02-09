import { NextResponse } from "next/server";
import { runDailyLearning } from "@/lib/triage/daily-learning";

export async function POST() {
  const result = await runDailyLearning();
  return NextResponse.json(result);
}
