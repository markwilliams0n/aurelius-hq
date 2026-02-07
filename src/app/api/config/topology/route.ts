import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemEvents, configs, inboxItems } from "@/lib/db/schema";
import { gte, desc, sql, count } from "drizzle-orm";

// --- Static topology definitions ---

interface NodeDef {
  id: string;
  type: "core" | "capability" | "connector" | "config";
  label: string;
  parent?: string;
  tools?: string[];
}

const NODES: NodeDef[] = [
  // Core nodes
  { id: "core:ai", type: "core", label: "AI Client" },
  { id: "core:memory", type: "core", label: "Memory" },
  { id: "core:config", type: "core", label: "Config System" },
  { id: "core:triage", type: "core", label: "Triage Inbox" },
  { id: "core:heartbeat", type: "core", label: "Heartbeat" },

  // Capability nodes
  {
    id: "capability:tasks",
    type: "capability",
    label: "Tasks",
    tools: [
      "list_tasks",
      "create_task",
      "update_task",
      "get_task",
      "get_team_context",
      "get_suggested_tasks",
    ],
  },
  {
    id: "capability:config",
    type: "capability",
    label: "Config",
    tools: ["list_configs", "read_config", "propose_config_change"],
  },
  {
    id: "capability:slack",
    type: "capability",
    label: "Slack Agent",
    tools: ["send_slack_message"],
  },

  // Connector nodes
  { id: "connector:gmail", type: "connector", label: "Gmail" },
  { id: "connector:slack", type: "connector", label: "Slack" },
  { id: "connector:linear", type: "connector", label: "Linear" },
  { id: "connector:granola", type: "connector", label: "Granola" },

  // Config nodes
  { id: "config:soul", type: "config", label: "Soul", parent: "core:config" },
  { id: "config:system_prompt", type: "config", label: "System Prompt", parent: "core:config" },
  { id: "config:agents", type: "config", label: "Agents", parent: "core:config" },
  { id: "config:processes", type: "config", label: "Processes", parent: "core:config" },
  { id: "config:capability:tasks", type: "config", label: "Tasks Config", parent: "capability:tasks" },
  { id: "config:capability:config", type: "config", label: "Config Config", parent: "capability:config" },
  { id: "config:capability:slack", type: "config", label: "Slack Config", parent: "capability:slack" },
  { id: "config:prompt:email_draft", type: "config", label: "Email Draft Prompt", parent: "connector:gmail" },
  { id: "config:slack:directory", type: "config", label: "Slack Directory", parent: "connector:slack" },
];

const CONFIG_KEY_MAP: Record<string, string> = {
  "config:soul": "soul",
  "config:system_prompt": "system_prompt",
  "config:agents": "agents",
  "config:processes": "processes",
  "config:capability:tasks": "capability:tasks",
  "config:capability:config": "capability:config",
  "config:capability:slack": "capability:slack",
  "config:prompt:email_draft": "prompt:email_draft",
  "config:slack:directory": "slack:directory",
};

interface EdgeDef {
  id: string;
  source: string;
  target: string;
  flowType: "ingest" | "processing" | "action" | "config";
}

const CONNECTORS = ["connector:gmail", "connector:slack", "connector:linear", "connector:granola"];
const CAPABILITIES = ["capability:tasks", "capability:config", "capability:slack"];

const EDGES: EdgeDef[] = [
  // Each connector -> core:triage (ingest)
  ...CONNECTORS.map((c) => ({
    id: `${c}->core:triage`,
    source: c,
    target: "core:triage",
    flowType: "ingest" as const,
  })),
  // core:triage -> core:memory (processing)
  { id: "core:triage->core:memory", source: "core:triage", target: "core:memory", flowType: "processing" },
  // core:ai -> each capability (processing)
  ...CAPABILITIES.map((c) => ({
    id: `core:ai->${c}`,
    source: "core:ai",
    target: c,
    flowType: "processing" as const,
  })),
  // Each config -> its parent (config)
  ...NODES.filter((n) => n.type === "config" && n.parent).map((n) => ({
    id: `${n.id}->${n.parent!}`,
    source: n.id,
    target: n.parent!,
    flowType: "config" as const,
  })),
  // capability:tasks -> connector:linear (action)
  { id: "capability:tasks->connector:linear", source: "capability:tasks", target: "connector:linear", flowType: "action" },
  // capability:slack -> connector:slack (action)
  { id: "capability:slack->connector:slack", source: "capability:slack", target: "connector:slack", flowType: "action" },
  // core:heartbeat -> each connector (processing)
  ...CONNECTORS.map((c) => ({
    id: `core:heartbeat->${c}`,
    source: "core:heartbeat",
    target: c,
    flowType: "processing" as const,
  })),
];

const CONNECTOR_MAP: Record<string, string> = {
  gmail: "connector:gmail",
  slack: "connector:slack",
  linear: "connector:linear",
  granola: "connector:granola",
};

export async function GET() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [eventVolumes, nodeCallCounts, configVersions, inboxCounts, recentEvents] = await Promise.all([
      db.select({ source: systemEvents.source, target: systemEvents.target, count: count() })
        .from(systemEvents).where(gte(systemEvents.createdAt, twentyFourHoursAgo))
        .groupBy(systemEvents.source, systemEvents.target),
      db.select({ source: systemEvents.source, count: count() })
        .from(systemEvents).where(gte(systemEvents.createdAt, twentyFourHoursAgo))
        .groupBy(systemEvents.source),
      db.select({ key: configs.key, version: sql<number>`max(${configs.version})` })
        .from(configs).groupBy(configs.key),
      db.select({ connector: inboxItems.connector, count: count() })
        .from(inboxItems).where(gte(inboxItems.createdAt, todayStart))
        .groupBy(inboxItems.connector),
      db.select().from(systemEvents).orderBy(desc(systemEvents.createdAt)).limit(50),
    ]);

    // Build lookup maps
    const edgeVolumeMap = new Map<string, number>();
    for (const row of eventVolumes) {
      if (row.target) edgeVolumeMap.set(`${row.source}->${row.target}`, Number(row.count));
    }
    const nodeCallMap = new Map<string, number>();
    for (const row of nodeCallCounts) nodeCallMap.set(row.source, Number(row.count));
    const configVersionMap = new Map<string, number>();
    for (const row of configVersions) configVersionMap.set(row.key, Number(row.version));
    const inboxCountMap = new Map<string, number>();
    for (const row of inboxCounts) {
      const id = CONNECTOR_MAP[row.connector];
      if (id) inboxCountMap.set(id, Number(row.count));
    }

    const nodes = NODES.map((node) => {
      const result: Record<string, unknown> = { id: node.id, type: node.type, label: node.label, status: "healthy" };
      if (node.parent) result.parent = node.parent;
      if (node.tools) result.tools = node.tools;

      const stats: Record<string, unknown> = {};
      const calls = nodeCallMap.get(node.id);
      if (calls !== undefined) stats.callsToday = calls;
      if (node.type === "config") {
        const configKey = CONFIG_KEY_MAP[node.id];
        if (configKey) {
          const version = configVersionMap.get(configKey);
          if (version !== undefined) stats.version = version;
        }
      }
      if (node.type === "connector") {
        const items = inboxCountMap.get(node.id);
        if (items !== undefined) stats.itemsToday = items;
      }
      if (Object.keys(stats).length > 0) result.stats = stats;
      return result;
    });

    const edges = EDGES.map((edge) => ({
      ...edge,
      volume24h: edgeVolumeMap.get(edge.id) ?? 0,
    }));

    const formattedEvents = recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      source: event.source,
      target: event.target ?? undefined,
      metadata: event.metadata ?? undefined,
      createdAt: event.createdAt.toISOString(),
    }));

    return NextResponse.json({ nodes, edges, recentEvents: formattedEvents });
  } catch (error) {
    console.error("Failed to build topology:", error);
    return NextResponse.json({ error: "Failed to build topology" }, { status: 500 });
  }
}
