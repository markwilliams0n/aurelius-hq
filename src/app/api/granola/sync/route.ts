import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncGranolaMeetings } from "@/lib/granola/sync";
import { saveCredentials, getCredentials } from "@/lib/granola/client";

// POST /api/granola/sync - Clear and re-sync Granola meetings
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const reset = searchParams.get("reset") === "true";

  try {
    if (reset) {
      // Clear all existing Granola items
      await db.delete(inboxItems).where(eq(inboxItems.connector, "granola"));

      // Reset sync timestamp to fetch all meetings
      const creds = await getCredentials();
      if (creds) {
        await saveCredentials({
          ...creds,
          last_synced_at: "2026-01-01T00:00:00.000Z",
        });
      }
    }

    // Run sync
    const result = await syncGranolaMeetings();

    return NextResponse.json({
      success: true,
      reset,
      ...result,
    });
  } catch (error) {
    console.error("[Granola Sync API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}
