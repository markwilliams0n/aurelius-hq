import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createMagicLink, isAdminEmail } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Only allow admin email
    if (!isAdminEmail(email)) {
      // Don't reveal that email isn't authorized
      return NextResponse.json({ success: true });
    }

    const token = await createMagicLink(email);
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/verify?token=${token}`;

    await resend.emails.send({
      from: "Aurelius <onboarding@resend.dev>",
      to: email,
      subject: "Your Aurelius login link",
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="color: #D4A853; font-size: 24px; margin-bottom: 24px;">Aurelius</h1>
          <p style="color: #666; margin-bottom: 24px;">Click the link below to sign in. This link expires in 15 minutes.</p>
          <a href="${magicLinkUrl}" style="display: inline-block; background: #D4A853; color: #0D0D14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Sign in to Aurelius</a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">If you didn't request this link, you can safely ignore this email.</p>
        </div>
      `,
    });

    await logActivity({
      eventType: "auth_login",
      actor: "system",
      description: `Magic link sent to ${email}`,
      metadata: { email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send magic link:", error);
    return NextResponse.json(
      { error: "Failed to send login link" },
      { status: 500 }
    );
  }
}
