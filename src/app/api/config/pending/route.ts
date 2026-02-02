import { NextRequest, NextResponse } from "next/server";
import { getPendingChanges, proposePendingChange, CONFIG_DESCRIPTIONS, ConfigKey } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { configKeyEnum } from "@/lib/db/schema";

function isValidKey(key: string): key is ConfigKey {
  return configKeyEnum.enumValues.includes(key as ConfigKey);
}

// GET /api/config/pending - List all pending changes
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await getPendingChanges();
  return NextResponse.json({ pending });
}

// POST /api/config/pending - Create a new pending change (used by agent)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key, proposedContent, reason, conversationId } = await request.json();

  if (!key || !isValidKey(key)) {
    return NextResponse.json({ error: "Invalid config key" }, { status: 400 });
  }

  if (!proposedContent || typeof proposedContent !== "string") {
    return NextResponse.json({ error: "Proposed content required" }, { status: 400 });
  }

  if (!reason || typeof reason !== "string") {
    return NextResponse.json({ error: "Reason required" }, { status: 400 });
  }

  const pending = await proposePendingChange(key, proposedContent, reason, conversationId);

  return NextResponse.json({ pending });
}
