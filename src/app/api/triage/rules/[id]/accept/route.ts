import { NextResponse } from "next/server";
import { acceptProposal } from "@/lib/triage/rule-proposals";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await acceptProposal(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Rules] Failed to accept proposal:", error);
    return NextResponse.json({ error: "Failed to accept" }, { status: 500 });
  }
}
