import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemEvents, configs, inboxItems } from "@/lib/db/schema";
import { gte, desc, sql, count } from "drizzle-orm";
import { ALL_CAPABILITIES } from "@/lib/capabilities";

// --- Types ---

interface NodeDef {
  id: string;
  type: "core" | "capability" | "connector" | "config";
  label: string;
  parent?: string;
  tools?: string[];
}

interface EdgeDef {
  id: string;
  source: string;
  target: string;
  flowType: "ingest" | "processing" | "action" | "config";
}

// --- Static core nodes (always present) ---

const CORE_NODES: NodeDef[] = [
  { id: "core:ai", type: "core", label: "AI Client" },
  { id: "core:memory", type: "core", label: "Memory" },
  { id: "core:config", type: "core", label: "Config System" },
  { id: "core:triage", type: "core", label: "Triage Inbox" },
  { id: "core:heartbeat", type: "core", label: "Heartbeat" },
];

// --- Display labels for known entities ---

const CAPABILITY_LABELS: Record<string, string> = {
  config: "Config",
  tasks: "Tasks",
  slack: "Slack Agent",
  vault: "Vault",
  code: "Code Agent",
  gmail: "Gmail Agent",
};

const CONNECTOR_LABELS: Record<string, string> = {
  gmail: "Gmail",
  slack: "Slack",
  linear: "Linear",
  granola: "Granola",
  manual: "Manual",
};

const CONFIG_LABELS: Record<string, string> = {
  soul: "Soul",
  system_prompt: "System Prompt",
  agents: "Agents",
  processes: "Processes",
  "prompt:email_draft": "Email Draft Prompt",
  "slack:directory": "Slack Directory",
};

// Config keys that belong to non-obvious parents (not core:config, not capability:X)
const CONFIG_PARENT_OVERRIDES: Record<string, string> = {
  "prompt:email_draft": "connector:gmail",
  "slack:directory": "connector:slack",
};

// Capabilities that act through a specific connector
const CAPABILITY_ACTION_TARGETS: Record<string, string> = {
  "capability:tasks": "connector:linear",
  "capability:slack": "connector:slack",
  "capability:gmail": "connector:gmail",
};

// Known connectors to show even when no inbox items exist yet
const KNOWN_CONNECTORS = ["gmail", "slack", "linear", "granola"];

// --- Dynamic node builders ---

function buildCapabilityNodes(): NodeDef[] {
  return ALL_CAPABILITIES.map((cap) => ({
    id: `capability:${cap.name}`,
    type: "capability" as const,
    label: CAPABILITY_LABELS[cap.name] || cap.name.charAt(0).toUpperCase() + cap.name.slice(1),
    tools: cap.tools.map((t) => t.name),
  }));
}

function buildConnectorNodes(dbConnectors: string[]): NodeDef[] {
  const connectorSet = new Set([...KNOWN_CONNECTORS, ...dbConnectors]);
  return Array.from(connectorSet).map((name) => ({
    id: `connector:${name}`,
    type: "connector" as const,
    label: CONNECTOR_LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1),
  }));
}

function buildConfigNodes(dbConfigKeys: string[], allNodeIds: Set<string>): NodeDef[] {
  return dbConfigKeys.map((key) => {
    // Determine parent node
    let parent: string;
    if (CONFIG_PARENT_OVERRIDES[key]) {
      parent = CONFIG_PARENT_OVERRIDES[key];
    } else if (key.startsWith("capability:")) {
      parent = key; // capability:tasks config → capability:tasks node
    } else {
      parent = "core:config";
    }

    // Only attach to parent if parent exists in topology
    if (!allNodeIds.has(parent)) {
      parent = "core:config";
    }

    // Derive label
    let label: string;
    if (CONFIG_LABELS[key]) {
      label = CONFIG_LABELS[key];
    } else if (key.startsWith("capability:")) {
      const capName = key.replace("capability:", "");
      const capLabel = CAPABILITY_LABELS[capName] || capName.charAt(0).toUpperCase() + capName.slice(1);
      label = `${capLabel} Config`;
    } else {
      label = key.split(":").pop()!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return {
      id: `config:${key}`,
      type: "config" as const,
      label,
      parent,
    };
  });
}

function buildEdges(nodes: NodeDef[]): EdgeDef[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const connectorIds = nodes.filter((n) => n.type === "connector").map((n) => n.id);
  const capabilityIds = nodes.filter((n) => n.type === "capability").map((n) => n.id);
  const configNodes = nodes.filter((n) => n.type === "config" && n.parent);

  const edges: EdgeDef[] = [];

  // Each connector → core:triage (ingest)
  for (const c of connectorIds) {
    edges.push({ id: `${c}->core:triage`, source: c, target: "core:triage", flowType: "ingest" });
  }

  // core:triage → core:memory (processing)
  edges.push({ id: "core:triage->core:memory", source: "core:triage", target: "core:memory", flowType: "processing" });

  // core:ai → each capability (processing)
  for (const c of capabilityIds) {
    edges.push({ id: `core:ai->${c}`, source: "core:ai", target: c, flowType: "processing" });
  }

  // Each config → its parent (config)
  for (const n of configNodes) {
    edges.push({ id: `${n.id}->${n.parent!}`, source: n.id, target: n.parent!, flowType: "config" });
  }

  // Capability action edges (only if target connector exists)
  for (const [capId, connId] of Object.entries(CAPABILITY_ACTION_TARGETS)) {
    if (nodeIds.has(capId) && nodeIds.has(connId)) {
      edges.push({ id: `${capId}->${connId}`, source: capId, target: connId, flowType: "action" });
    }
  }

  // core:heartbeat → each connector (processing)
  for (const c of connectorIds) {
    edges.push({ id: `core:heartbeat->${c}`, source: "core:heartbeat", target: c, flowType: "processing" });
  }

  return edges;
}

// --- GET handler ---

export async function GET() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [eventVolumes, nodeCallCounts, configRows, inboxCounts, connectorRows, recentEvents] = await Promise.all([
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
      db.selectDistinct({ connector: inboxItems.connector })
        .from(inboxItems),
      db.select().from(systemEvents).orderBy(desc(systemEvents.createdAt)).limit(50),
    ]);

    // Build dynamic topology
    const capabilityNodes = buildCapabilityNodes();
    const dbConnectors = connectorRows.map((r) => r.connector);
    const connectorNodes = buildConnectorNodes(dbConnectors);

    // Collect all non-config node IDs so config nodes can validate parents
    const nonConfigNodes = [...CORE_NODES, ...capabilityNodes, ...connectorNodes];
    const nonConfigIds = new Set(nonConfigNodes.map((n) => n.id));

    const dbConfigKeys = configRows.map((r) => r.key);
    const configNodes = buildConfigNodes(dbConfigKeys, nonConfigIds);

    const allNodes = [...nonConfigNodes, ...configNodes];
    const allEdges = buildEdges(allNodes);

    // Build lookup maps for stats
    const edgeVolumeMap = new Map<string, number>();
    for (const row of eventVolumes) {
      if (row.target) edgeVolumeMap.set(`${row.source}->${row.target}`, Number(row.count));
    }
    const nodeCallMap = new Map<string, number>();
    for (const row of nodeCallCounts) nodeCallMap.set(row.source, Number(row.count));
    const configVersionMap = new Map<string, number>();
    for (const row of configRows) configVersionMap.set(row.key, Number(row.version));
    const inboxCountMap = new Map<string, number>();
    for (const row of inboxCounts) {
      inboxCountMap.set(`connector:${row.connector}`, Number(row.count));
    }

    // Enrich nodes with stats
    const nodes = allNodes.map((node) => {
      const result: Record<string, unknown> = { id: node.id, type: node.type, label: node.label, status: "healthy" };
      if (node.parent) result.parent = node.parent;
      if (node.tools) result.tools = node.tools;

      const stats: Record<string, unknown> = {};
      const calls = nodeCallMap.get(node.id);
      if (calls !== undefined) stats.callsToday = calls;
      if (node.type === "config") {
        // Config node ID is "config:<key>", extract the key
        const configKey = node.id.replace(/^config:/, "");
        const version = configVersionMap.get(configKey);
        if (version !== undefined) stats.version = version;
      }
      if (node.type === "connector") {
        const items = inboxCountMap.get(node.id);
        if (items !== undefined) stats.itemsToday = items;
      }
      if (Object.keys(stats).length > 0) result.stats = stats;
      return result;
    });

    const edges = allEdges.map((edge) => ({
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
