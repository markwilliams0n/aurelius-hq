import { db } from "@/lib/db";
import { memoryEvents, type NewMemoryEvent, type MemoryEvent } from "@/lib/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";

// --- Types ---

export type MemoryEventType = "recall" | "extract" | "save" | "search" | "reindex" | "evaluate";
export type MemoryEventTrigger = "chat" | "heartbeat" | "triage" | "manual" | "api";

export interface EmitMemoryEventParams {
  eventType: MemoryEventType;
  trigger: MemoryEventTrigger;
  triggerId?: string;
  summary: string;
  payload?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

// --- In-Memory Buffer ---
// Use globalThis to survive Next.js hot-module reloads in development.
// Without this, each hot reload creates a new module scope with fresh
// buffer/listeners, breaking SSE connections that hold old references.

const BUFFER_MAX = 100;

const globalStore = globalThis as unknown as {
  __memoryEventBuffer?: MemoryEvent[];
  __memoryEventListeners?: Set<(event: MemoryEvent) => void>;
};

if (!globalStore.__memoryEventBuffer) {
  globalStore.__memoryEventBuffer = [];
}
if (!globalStore.__memoryEventListeners) {
  globalStore.__memoryEventListeners = new Set();
}

const eventBuffer = globalStore.__memoryEventBuffer;
const listeners = globalStore.__memoryEventListeners;

export function getRecentEvents(limit = 20): MemoryEvent[] {
  return eventBuffer.slice(0, limit);
}

export function onMemoryEvent(listener: (event: MemoryEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- Emit ---

export async function emitMemoryEvent(params: EmitMemoryEventParams): Promise<MemoryEvent | null> {
  const row: NewMemoryEvent = {
    eventType: params.eventType,
    trigger: params.trigger,
    triggerId: params.triggerId ?? null,
    summary: params.summary,
    payload: params.payload ?? null,
    reasoning: params.reasoning ?? null,
    evaluation: params.evaluation ?? null,
    durationMs: params.durationMs ?? null,
    metadata: params.metadata ?? null,
  };

  const now = new Date();

  // Write to DB first to get the canonical ID
  let bufferEntry: MemoryEvent;
  try {
    const [inserted] = await db.insert(memoryEvents).values(row).returning();
    bufferEntry = inserted;
  } catch (error) {
    console.error("[MemoryEvents] DB write failed:", error);
    // Fallback: use a local ID so the event still appears in the overlay
    bufferEntry = {
      ...row,
      id: crypto.randomUUID(),
      timestamp: now,
    } as MemoryEvent;
  }

  eventBuffer.unshift(bufferEntry);
  if (eventBuffer.length > BUFFER_MAX) {
    eventBuffer.pop();
  }

  for (const listener of listeners) {
    try {
      listener(bufferEntry);
    } catch {
      // Don't let listener errors break emit
    }
  }

  return bufferEntry;
}

// --- Query ---

export async function getMemoryEvents(options: {
  limit?: number;
  eventType?: MemoryEventType;
  trigger?: MemoryEventTrigger;
  since?: Date;
} = {}): Promise<MemoryEvent[]> {
  const { limit = 50, eventType, trigger, since } = options;

  const conditions = [];
  if (eventType) conditions.push(eq(memoryEvents.eventType, eventType));
  if (trigger) conditions.push(eq(memoryEvents.trigger, trigger));
  if (since) conditions.push(gte(memoryEvents.timestamp, since));

  return db
    .select()
    .from(memoryEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memoryEvents.timestamp))
    .limit(limit);
}
