import { NextRequest, NextResponse } from "next/server";
import { getPendingChange, approvePendingChange, rejectPendingChange } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { appendActivityLog, SystemLogEntry } from "@/lib/memory/activity-log";

// GET /api/config/pending/[id] - Get a specific pending change
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const pending = await getPendingChange(id);

  if (!pending) {
    return NextResponse.json({ error: "Pending change not found" }, { status: 404 });
  }

  return NextResponse.json({ pending });
}

// POST /api/config/pending/[id] - Approve or reject a pending change
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { action } = await request.json();

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const pending = await getPendingChange(id);
  if (!pending) {
    return NextResponse.json({ error: "Pending change not found" }, { status: 404 });
  }

  if (action === "approve") {
    const config = await approvePendingChange(id);
    if (!config) {
      return NextResponse.json({ error: "Failed to approve change" }, { status: 500 });
    }

    // Log to activity
    const logEntry: SystemLogEntry = {
      id: `sys-${Date.now()}`,
      type: "system",
      action: "config_change",
      message: `Approved config change: ${pending.key} (v${config.version})`,
      timestamp: new Date().toISOString(),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json({ success: true, config });
  } else {
    const success = await rejectPendingChange(id);
    if (!success) {
      return NextResponse.json({ error: "Failed to reject change" }, { status: 500 });
    }

    // Log to activity
    const logEntry: SystemLogEntry = {
      id: `sys-${Date.now()}`,
      type: "system",
      action: "config_change",
      message: `Rejected config change: ${pending.key}`,
      timestamp: new Date().toISOString(),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json({ success: true });
  }
}
