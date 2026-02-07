/**
 * System Event Logger
 *
 * Lightweight instrumentation for tracking activity across the system.
 * Powers the neural map's edge animations, node stats, and activity ticker.
 */

import { db } from "@/lib/db";
import { systemEvents } from "@/lib/db/schema";

type EventType = "tool_call" | "connector_sync" | "config_change" | "capability_use";

export async function logSystemEvent(
  eventType: EventType,
  source: string,
  target?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(systemEvents).values({
      eventType,
      source,
      target,
      metadata: metadata ?? {},
    });
  } catch (error) {
    // Never let event logging break the main flow
    console.error("[SystemEvents] Failed to log event:", error);
  }
}

// Convenience helpers
export const logToolCall = (toolName: string, capabilitySource: string, metadata?: Record<string, unknown>) =>
  logSystemEvent("tool_call", capabilitySource, `tool:${toolName}`, { toolName, ...metadata });

export const logConnectorSync = (connector: string, itemCount: number, metadata?: Record<string, unknown>) =>
  logSystemEvent("connector_sync", `connector:${connector}`, "core:triage", { itemCount, ...metadata });

export const logConfigChange = (configKey: string, actor: string) =>
  logSystemEvent("config_change", `config:${configKey}`, "core:config", { actor });

export const logCapabilityUse = (capability: string, toolName: string, metadata?: Record<string, unknown>) =>
  logSystemEvent("capability_use", `capability:${capability}`, `tool:${toolName}`, { toolName, ...metadata });
