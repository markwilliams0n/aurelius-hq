import { NextRequest, NextResponse } from "next/server";
import { getConfig, updateConfig, getConfigHistory } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { configKeyEnum } from "@/lib/db/schema";

type ConfigKey = (typeof configKeyEnum.enumValues)[number];

function isValidKey(key: string): key is ConfigKey {
  return configKeyEnum.enumValues.includes(key as ConfigKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid config key" }, { status: 400 });
  }

  const history = request.nextUrl.searchParams.get("history") === "true";

  if (history) {
    const configs = await getConfigHistory(key);
    return NextResponse.json({ configs });
  }

  const config = await getConfig(key);

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  return NextResponse.json({ config });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid config key" }, { status: 400 });
  }

  const { content } = await request.json();

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  const config = await updateConfig(key, content, "user");

  await logActivity({
    eventType: "config_updated",
    actor: "user",
    description: `Updated config: ${key} (v${config.version})`,
    metadata: { key, version: config.version },
  });

  return NextResponse.json({ config });
}
