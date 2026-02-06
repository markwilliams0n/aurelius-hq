import { NextRequest, NextResponse } from "next/server";
import { getMemoryEvents, type MemoryEventType, type MemoryEventTrigger } from "@/lib/memory/events";

const VALID_EVENT_TYPES: MemoryEventType[] = ["recall", "extract", "save", "search", "reindex", "evaluate"];
const VALID_TRIGGERS: MemoryEventTrigger[] = ["chat", "heartbeat", "triage", "manual", "api"];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const rawEventType = searchParams.get("eventType");
  const eventType = rawEventType && VALID_EVENT_TYPES.includes(rawEventType as MemoryEventType)
    ? (rawEventType as MemoryEventType) : undefined;

  const rawTrigger = searchParams.get("trigger");
  const trigger = rawTrigger && VALID_TRIGGERS.includes(rawTrigger as MemoryEventTrigger)
    ? (rawTrigger as MemoryEventTrigger) : undefined;

  const sinceStr = searchParams.get("since");
  const since = sinceStr ? new Date(sinceStr) : undefined;

  const events = await getMemoryEvents({ limit, eventType, trigger, since });
  return NextResponse.json({ events });
}
