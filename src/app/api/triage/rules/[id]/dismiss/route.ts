import { NextResponse } from "next/server";
import { dismissProposal } from "@/lib/triage/rule-proposals";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await dismissProposal(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Rules] Failed to dismiss proposal:", error);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
