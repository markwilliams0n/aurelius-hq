import { onMemoryEvent, getRecentEvents, getMemoryEvents } from "@/lib/memory/events";

export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller closed
        }
      }

      // Send recent events on connect — try buffer first, fall back to DB
      let recent = getRecentEvents(20);
      if (recent.length === 0) {
        try {
          recent = await getMemoryEvents({ limit: 20 });
        } catch {
          // DB query failed, proceed with empty
        }
      }
      send({ type: "init", events: recent });

      // Stream new events
      unsubscribe = onMemoryEvent((event) => {
        send({ type: "event", event });
      });

      // Heartbeat to keep connection alive
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Controller closed — clean up both interval and listener
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (unsubscribe) unsubscribe();
        }
      }, 30000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
