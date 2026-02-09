import { NextResponse } from "next/server";
import { actionBatchCard } from "@/lib/triage/batch-cards";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { checkedItemIds, uncheckedItemIds } = await request.json();
    await actionBatchCard(id, checkedItemIds || [], uncheckedItemIds || []);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Batch action failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
