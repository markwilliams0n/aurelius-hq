import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAllTags } from "@/lib/vault";

/**
 * GET /api/vault/tags — Get all unique tags across vault items
 *
 * Returns { tags: string[] }
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tags = await getAllTags();
    return NextResponse.json({ tags });
  } catch (error) {
    console.error("[Vault API] Tags error:", error);
    return NextResponse.json(
      { error: "Failed to get tags" },
      { status: 500 }
    );
  }
}
