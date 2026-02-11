import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[OpenRouter Balance] API error:", response.status, errorText);
      return NextResponse.json(
        { error: `OpenRouter API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[OpenRouter Balance] Fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch balance data" },
      { status: 500 }
    );
  }
}
