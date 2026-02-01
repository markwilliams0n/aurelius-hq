import { NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST() {
  const session = await getSession();

  if (session) {
    await logActivity({
      eventType: "auth_logout",
      actor: "user",
      description: `User logged out: ${session.user.email}`,
      metadata: { userId: session.user.id },
    });
  }

  await destroySession();

  return NextResponse.json({ success: true });
}
