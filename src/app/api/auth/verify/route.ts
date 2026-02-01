import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, createSession, isAdminEmail } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const link = await verifyMagicLink(token);

  if (!link) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  if (!isAdminEmail(link.email)) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  const user = await createSession(link.email);

  await logActivity({
    eventType: "auth_login",
    actor: "user",
    description: `User logged in: ${user.email}`,
    metadata: { userId: user.id, email: user.email },
  });

  return NextResponse.redirect(new URL("/", request.url));
}
