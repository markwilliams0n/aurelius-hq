import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readDailyNote, appendToDailyNote } from "@/lib/memory/daily-notes";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const content = await readDailyNote();
  return NextResponse.json({ content: content || "" });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { content } = await request.json();

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  await appendToDailyNote(content);
  return NextResponse.json({ success: true });
}
