"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  getBezierPath,
  BaseEdge,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AppShell } from "@/components/aurelius/app-shell";
import { cn } from "@/lib/utils";
import { X, Loader2, Eye, EyeOff } from "lucide-react";

// --- Types ---

interface TopologyNode {
  id: string;
  type: "core" | "capability" | "connector" | "config";
  label: string;
  status: string;
  parent?: string;
  tools?: string[];
  stats?: {
    callsToday?: number;
    lastSync?: string;
    itemsToday?: number;
    version?: number;
  };
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  flowType: "ingest" | "processing" | "action" | "config";
  volume24h: number;
}

interface TopologyEvent {
  id: string;
  eventType: string;
  source: string;
  target?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  recentEvents: TopologyEvent[];
}

// --- Node descriptions ---

const NODE_DESCRIPTIONS: Record<string, string> = {
  "core:ai": "Central AI client powered by OpenRouter. Routes all LLM calls, manages tool use, and orchestrates agent responses.",
  "core:memory": "Long-term memory system. Stores entities, facts, and relationships extracted from conversations and data sources.",
  "core:config": "Versioned configuration store. All system behavior is defined by editable config documents with full history.",
  "core:triage": "Incoming data processing. Receives items from all connectors, classifies priority, and routes for action.",
  "core:heartbeat": "Scheduled background loop. Syncs connectors, refreshes caches, and performs periodic maintenance tasks.",
  "capability:tasks": "Task management via Linear. Creates, updates, and tracks engineering tasks and project work.",
  "capability:config": "Self-modification capability. Allows the agent to propose changes to its own configuration.",
  "capability:slack": "Slack messaging agent. Sends DMs and channel messages on behalf of the user with context awareness.",
  "connector:gmail": "Gmail inbox connector. Syncs recent emails, extracts metadata, and routes to triage.",
  "connector:slack": "Slack workspace connector. Monitors channels and DMs, syncs messages to triage.",
  "connector:linear": "Linear project connector. Syncs issues, comments, and project updates to triage.",
  "connector:granola": "Granola meeting connector. Syncs meeting notes and transcripts to triage.",
  "config:soul": "Personality and behavioral instructions. Defines communication tone, special behaviors, and interaction style.",
  "config:system_prompt": "Core system prompt defining fundamental capabilities, context, and behavioral boundaries.",
  "config:agents": "Sub-agent configuration for specialized task handling (future use).",
  "config:processes": "Automated process definitions and scheduled workflows (future use).",
  "config:capability:tasks": "Instructions governing how the agent manages tasks via Linear — priorities, labels, workflows.",
  "config:capability:config": "Instructions for self-modification — what configs the agent can propose changes to and how.",
  "config:capability:slack": "Instructions for Slack messaging — tone, formatting, when to send, cc behavior.",
  "config:prompt:email_draft": "Prompt template controlling AI-generated email draft replies — tone, style, formatting.",
  "config:slack:directory": "Cached Slack workspace directory of users and channels. Auto-refreshed daily by heartbeat.",
};

// --- Flow type colors ---

const FLOW_COLORS: Record<string, string> = {
  ingest: "#00d4ff",
  processing: "#bf5af2",
  action: "#ff9f0a",
  config: "#30d158",
};

const NODE_TYPE_COLORS: Record<string, { primary: string; glow: string }> = {
  core: { primary: "#D4A843", glow: "rgba(212, 168, 67, 0.4)" },
  capability: { primary: "#bf5af2", glow: "rgba(191, 90, 242, 0.4)" },
  connector: { primary: "#00d4ff", glow: "rgba(0, 212, 255, 0.4)" },
  config: { primary: "#30d158", glow: "rgba(48, 209, 88, 0.3)" },
};

const NODE_TYPE_LABELS: Record<string, string> = {
  core: "Core Systems",
  capability: "Capabilities",
  connector: "Connectors",
  config: "Configs",
};

// --- Layout positions ---

const CENTER = { x: 450, y: 350 };

const CORE_POSITIONS: Record<string, { x: number; y: number }> = {
  "core:ai": { x: CENTER.x, y: CENTER.y - 100 },
  "core:memory": { x: CENTER.x + 120, y: CENTER.y + 20 },
  "core:config": { x: CENTER.x - 120, y: CENTER.y + 20 },
  "core:triage": { x: CENTER.x, y: CENTER.y + 100 },
  "core:heartbeat": { x: CENTER.x, y: CENTER.y + 220 },
};

const CAPABILITY_POSITIONS: Record<string, { x: number; y: number }> = {
  "capability:tasks": { x: CENTER.x + 280, y: CENTER.y - 120 },
  "capability:config": { x: CENTER.x - 280, y: CENTER.y - 120 },
  "capability:slack": { x: CENTER.x + 280, y: CENTER.y + 40 },
};

const CONNECTOR_POSITIONS: Record<string, { x: number; y: number }> = {
  "connector:gmail": { x: CENTER.x - 320, y: CENTER.y + 220 },
  "connector:slack": { x: CENTER.x - 100, y: CENTER.y + 360 },
  "connector:linear": { x: CENTER.x + 320, y: CENTER.y + 220 },
  "connector:granola": { x: CENTER.x + 100, y: CENTER.y + 360 },
};

function getConfigPosition(nodeId: string, parentId: string): { x: number; y: number } {
  const parentPos =
    CORE_POSITIONS[parentId] ||
    CAPABILITY_POSITIONS[parentId] ||
    CONNECTOR_POSITIONS[parentId] ||
    CENTER;

  const configIndex = [
    "config:soul", "config:system_prompt", "config:agents", "config:processes",
    "config:capability:tasks", "config:capability:config", "config:capability:slack",
    "config:prompt:email_draft", "config:slack:directory",
  ].indexOf(nodeId);
  const angle = ((configIndex % 4) * 90 + 45) * (Math.PI / 180);
  const radius = 70;
  return {
    x: parentPos.x + Math.cos(angle) * radius,
    y: parentPos.y + Math.sin(angle) * radius,
  };
}

// --- Config key mapping (node id -> API key) ---

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

// --- Custom Node Components ---

function CoreNode({ data }: NodeProps) {
  const d = data as { label: string; status: string; stats?: Record<string, unknown> };
  const colors = NODE_TYPE_COLORS.core;
  const calls = Number(d.stats?.callsToday ?? 0);
  const glowIntensity = Math.min(calls / 20, 1);
  const glowSize = 20 + glowIntensity * 25;
  return (
    <div
      className="relative px-5 py-3 rounded-xl border text-center min-w-[150px] transition-shadow duration-1000"
      style={{
        borderColor: colors.primary,
        background: "rgba(10, 10, 15, 0.95)",
        boxShadow: `0 0 ${glowSize}px ${colors.glow}, inset 0 0 20px rgba(212, 168, 67, 0.05)`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex items-center gap-2 justify-center">
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: colors.primary, boxShadow: `0 0 ${6 + glowIntensity * 8}px ${colors.primary}` }}
        />
        <span className="font-bold text-sm" style={{ color: colors.primary }}>{d.label}</span>
      </div>
      {d.stats?.callsToday != null && (
        <div className="text-[10px] text-white/40 mt-1 font-mono">{String(d.stats.callsToday)} calls today</div>
      )}
    </div>
  );
}

function CapabilityNode({ data }: NodeProps) {
  const d = data as { label: string; tools?: string[]; stats?: Record<string, unknown> };
  const colors = NODE_TYPE_COLORS.capability;
  const calls = Number(d.stats?.callsToday ?? 0);
  const glowSize = 15 + Math.min(calls / 20, 1) * 20;
  return (
    <div
      className="relative px-4 py-2.5 rounded-lg border text-center min-w-[130px] transition-shadow duration-1000"
      style={{
        borderColor: colors.primary + "80",
        background: "rgba(10, 10, 15, 0.92)",
        boxShadow: `0 0 ${glowSize}px ${colors.glow}`,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="text-sm font-semibold" style={{ color: colors.primary }}>{d.label}</div>
      {d.tools && (
        <div className="text-[10px] mt-0.5 font-mono" style={{ color: colors.primary + "99" }}>{d.tools.length} tools</div>
      )}
      {d.stats?.callsToday != null && (
        <div className="text-[10px] text-white/40 font-mono">{String(d.stats.callsToday)} calls</div>
      )}
    </div>
  );
}

function ConnectorNode({ data }: NodeProps) {
  const d = data as { label: string; status: string; stats?: Record<string, unknown> };
  const colors = NODE_TYPE_COLORS.connector;
  const items = Number(d.stats?.itemsToday ?? 0);
  const glowSize = 15 + Math.min(items / 30, 1) * 20;
  return (
    <div
      className="relative px-4 py-2.5 rounded-lg border text-center min-w-[130px] transition-shadow duration-1000"
      style={{
        borderColor: colors.primary + "80",
        background: "rgba(10, 10, 15, 0.92)",
        boxShadow: `0 0 ${glowSize}px ${colors.glow}`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex items-center gap-2 justify-center">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.primary, boxShadow: `0 0 ${6 + Math.min(items / 30, 1) * 8}px ${colors.primary}` }}
        />
        <span className="text-sm font-semibold" style={{ color: colors.primary }}>{d.label}</span>
      </div>
      {d.stats?.itemsToday != null && (
        <div className="text-[10px] mt-0.5 font-mono" style={{ color: colors.primary + "99" }}>{String(d.stats.itemsToday)} items today</div>
      )}
    </div>
  );
}

function ConfigNodeComponent({ data }: NodeProps) {
  const d = data as { label: string; stats?: Record<string, unknown> };
  const colors = NODE_TYPE_COLORS.config;
  return (
    <div
      className="relative px-3 py-1.5 rounded-full border text-center"
      style={{
        borderColor: colors.primary + "50",
        background: "rgba(10, 10, 15, 0.85)",
        boxShadow: `0 0 10px ${colors.glow}`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="text-[11px] font-mono" style={{ color: colors.primary }}>{d.label}</div>
      {d.stats?.version != null && (
        <div className="text-[9px] text-white/30 font-mono">v{String(d.stats.version)}</div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  core: CoreNode,
  capability: CapabilityNode,
  connector: ConnectorNode,
  config: ConfigNodeComponent,
};

// --- Custom Pulse Edge ---

function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const color = (style?.stroke as string) || "#666";
  const edgeData = data as Record<string, unknown> | undefined;
  const isActive = edgeData?.active === true;
  const intensity = Number(edgeData?.intensity ?? 0);

  // Scale pulse count (1-5) and speed based on volume intensity
  const pulseCount = isActive ? Math.max(1, Math.min(5, Math.ceil(intensity * 5))) : 0;
  const baseDuration = 3 - intensity * 1.5; // faster when busier (3s -> 1.5s)
  const filterId = `pulse-glow-${id}`;

  return (
    <>
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix in="blur" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1.8 0" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Dim base path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          opacity: isActive ? 0.15 + intensity * 0.15 : (style?.opacity ?? 0.08),
          filter: undefined,
        }}
      />

      {/* Pulse dots traveling along the path */}
      {Array.from({ length: pulseCount }).map((_, i) => {
        const dur = baseDuration + i * 0.3;
        const delay = i * (baseDuration / pulseCount);
        const dotSize = 2 + intensity * 2;
        return (
          <circle
            key={`${id}-pulse-${i}`}
            r={dotSize}
            fill={color}
            filter={`url(#${filterId})`}
          >
            <animateMotion
              dur={`${dur}s`}
              repeatCount="indefinite"
              begin={`${delay}s`}
              path={edgePath}
            />
            <animate
              attributeName="opacity"
              values="0;0.9;0.9;0"
              keyTimes="0;0.08;0.75;1"
              dur={`${dur}s`}
              repeatCount="indefinite"
              begin={`${delay}s`}
            />
            <animate
              attributeName="r"
              values={`${dotSize * 0.6};${dotSize};${dotSize * 0.6}`}
              dur={`${dur}s`}
              repeatCount="indefinite"
              begin={`${delay}s`}
            />
          </circle>
        );
      })}
    </>
  );
}

const edgeTypes: EdgeTypes = {
  pulse: PulseEdge,
};

// --- Stats HUD ---

function StatsHUD({ topology }: { topology: Topology }) {
  const stats = useMemo(() => {
    const totalEvents = topology.edges.reduce((sum, e) => sum + e.volume24h, 0);
    const activeConnectors = topology.nodes.filter(
      (n) => n.type === "connector" && (n.stats?.itemsToday ?? 0) > 0
    ).length;
    const totalConnectors = topology.nodes.filter((n) => n.type === "connector").length;
    const activeCapabilities = topology.nodes.filter(
      (n) => n.type === "capability" && (n.stats?.callsToday ?? 0) > 0
    ).length;
    const totalCapabilities = topology.nodes.filter((n) => n.type === "capability").length;
    const configCount = topology.nodes.filter((n) => n.type === "config").length;
    return { totalEvents, activeConnectors, totalConnectors, activeCapabilities, totalCapabilities, configCount };
  }, [topology]);

  const items = [
    { label: "Events 24h", value: stats.totalEvents.toLocaleString(), color: "#bf5af2" },
    { label: "Connectors", value: `${stats.activeConnectors}/${stats.totalConnectors}`, color: "#00d4ff" },
    { label: "Capabilities", value: `${stats.activeCapabilities}/${stats.totalCapabilities}`, color: "#bf5af2" },
    { label: "Configs", value: String(stats.configCount), color: "#30d158" },
  ];

  return (
    <div className="absolute bottom-4 right-4 z-10 bg-[#0a0a0f]/80 backdrop-blur-md rounded-lg border border-white/5 p-3">
      <div className="text-[10px] text-white/20 uppercase tracking-wider font-mono mb-2">System Status</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2">
            <span className="text-[10px] text-white/30 font-mono">{item.label}</span>
            <span className="text-sm font-mono font-bold" style={{ color: item.color }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Ambient Particles ---

const PARTICLE_STYLE = `
@keyframes cortex-float {
  0%, 100% { transform: translate(0, 0); opacity: 0; }
  10% { opacity: 0.6; }
  90% { opacity: 0.6; }
  50% { transform: translate(var(--dx), var(--dy)); }
}
.cortex-particle {
  position: absolute;
  border-radius: 50%;
  animation: cortex-float var(--dur) ease-in-out infinite;
  animation-delay: var(--delay);
  pointer-events: none;
}
`;

// Pre-compute particles so they don't change on re-render
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 100}%`,
  size: 1 + Math.random() * 2,
  dx: `${(Math.random() - 0.5) * 80}px`,
  dy: `${(Math.random() - 0.5) * 80}px`,
  dur: `${8 + Math.random() * 12}s`,
  delay: `${-Math.random() * 15}s`,
  color: ["#D4A843", "#bf5af2", "#00d4ff", "#30d158"][Math.floor(Math.random() * 4)],
}));

function AmbientParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <style dangerouslySetInnerHTML={{ __html: PARTICLE_STYLE }} />
      {PARTICLES.map((p) => (
        <div
          key={p.id}
          className="cortex-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
            "--dx": p.dx,
            "--dy": p.dy,
            "--dur": p.dur,
            "--delay": p.delay,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

// --- Detail Panel ---

function DetailPanel({ node, onClose }: { node: TopologyNode; onClose: () => void }) {
  const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
  const colors = NODE_TYPE_COLORS[node.type];
  const description = NODE_DESCRIPTIONS[node.id];
  const configKey = CONFIG_KEY_MAP[node.id];

  const [configContent, setConfigContent] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    if (node.type === "config" && configKey) {
      setConfigLoading(true);
      setConfigContent(null);
      fetch(`/api/config/${encodeURIComponent(configKey)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.config?.content) {
            setConfigContent(data.config.content);
          }
        })
        .catch(() => {})
        .finally(() => setConfigLoading(false));
    }
  }, [node.id, node.type, configKey]);

  return (
    <div
      className="h-full border-l bg-[#0a0a0f] p-4 overflow-y-auto w-80"
      style={{ borderColor: colors.primary + "30" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-lg text-white">{node.label}</h3>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-mono"
            style={{ color: colors.primary, border: `1px solid ${colors.primary}50` }}
          >
            {typeLabel}
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors">
          <X className="w-4 h-4 text-white/50" />
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: colors.primary, boxShadow: `0 0 6px ${colors.primary}` }}
        />
        <span className="text-sm text-white/50 font-mono">{node.status}</span>
      </div>

      {/* Description */}
      {description && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: colors.primary + "08", border: `1px solid ${colors.primary}15` }}>
          <p className="text-sm text-white/70 leading-relaxed">{description}</p>
        </div>
      )}

      {/* Stats */}
      {node.stats && (
        <div className="space-y-2 mb-4">
          <h4 className="text-xs font-semibold text-white/30 uppercase tracking-wider font-mono">Stats</h4>
          {node.stats.callsToday != null && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Calls today</span>
              <span className="text-white/80 font-mono">{node.stats.callsToday}</span>
            </div>
          )}
          {node.stats.itemsToday != null && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Items today</span>
              <span className="text-white/80 font-mono">{node.stats.itemsToday}</span>
            </div>
          )}
          {node.stats.version != null && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Version</span>
              <span className="text-white/80 font-mono">v{node.stats.version}</span>
            </div>
          )}
        </div>
      )}

      {/* Tools */}
      {node.tools && node.tools.length > 0 && (
        <div className="space-y-2 mb-4">
          <h4 className="text-xs font-semibold text-white/30 uppercase tracking-wider font-mono">Tools</h4>
          <div className="space-y-1">
            {node.tools.map((tool) => (
              <div
                key={tool}
                className="text-sm font-mono px-2 py-1 rounded"
                style={{ background: colors.primary + "15", color: colors.primary + "cc" }}
              >
                {tool}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config content */}
      {node.type === "config" && configKey && (
        <div className="space-y-2 mb-4">
          <h4 className="text-xs font-semibold text-white/30 uppercase tracking-wider font-mono">Content</h4>
          {configLoading ? (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading...
            </div>
          ) : configContent ? (
            <pre
              className="text-xs font-mono p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words"
              style={{ background: "rgba(0,0,0,0.5)", color: NODE_TYPE_COLORS.config.primary + "cc", border: `1px solid ${NODE_TYPE_COLORS.config.primary}20` }}
            >
              {configContent.length > 2000 ? configContent.slice(0, 2000) + "\n\n... (truncated)" : configContent}
            </pre>
          ) : (
            <div className="text-sm text-white/30 italic">No content found</div>
          )}
        </div>
      )}

      {/* Parent */}
      {node.parent && (
        <div className="mt-4 text-sm text-white/40 font-mono">
          Parent: <span className="text-white/70">{node.parent}</span>
        </div>
      )}
    </div>
  );
}

// --- Activity Ticker ---

function ActivityTicker({ events }: { events: TopologyEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="h-10 border-t border-white/5 bg-[#06060a]/90 backdrop-blur flex items-center px-4">
        <span className="text-xs text-white/20 font-mono">NO RECENT ACTIVITY</span>
      </div>
    );
  }

  return (
    <div className="h-10 border-t border-white/5 bg-[#06060a]/90 backdrop-blur flex items-center gap-6 px-4 overflow-x-auto">
      <span className="text-[10px] text-white/20 font-mono shrink-0 uppercase tracking-wider">Live</span>
      {events.slice(0, 20).map((event) => {
        const time = new Date(event.createdAt);
        const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const color = FLOW_COLORS[event.eventType === "connector_sync" ? "ingest" :
          event.eventType === "tool_call" ? "action" :
          event.eventType === "config_change" ? "config" : "processing"];
        return (
          <div key={event.id} className="flex items-center gap-2 text-xs whitespace-nowrap shrink-0 font-mono">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
            <span className="text-white/25">{timeStr}</span>
            <span className="text-white/60">{event.source.replace(/^(connector|capability|config|core):/, "")}</span>
            <span className="text-white/25">{event.eventType.replace("_", " ")}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Filter Toggles ---

type NodeTypeFilter = "core" | "capability" | "connector" | "config";

function FilterBar({
  filters,
  onToggle,
}: {
  filters: Record<NodeTypeFilter, boolean>;
  onToggle: (type: NodeTypeFilter) => void;
}) {
  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-[#0a0a0f]/80 backdrop-blur-md rounded-lg p-2 border border-white/5">
      {(Object.keys(NODE_TYPE_LABELS) as NodeTypeFilter[]).map((type) => {
        const colors = NODE_TYPE_COLORS[type];
        const active = filters[type];
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all",
              active ? "bg-white/5" : "bg-transparent opacity-40",
            )}
            style={active ? { color: colors.primary, borderColor: colors.primary + "30", border: "1px solid" } : { color: colors.primary }}
          >
            {active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {NODE_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}

// --- Main Component ---

export function ConfigHome() {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [filters, setFilters] = useState<Record<NodeTypeFilter, boolean>>({
    core: true,
    capability: true,
    connector: true,
    config: true,
  });

  const toggleFilter = useCallback((type: NodeTypeFilter) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch("/api/config/topology");
      if (!res.ok) throw new Error("Failed to fetch");
      const data: Topology = await res.json();
      setTopology(data);
    } catch (err) {
      console.error("Failed to fetch topology:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Rebuild flow nodes/edges when topology or filters change
  useEffect(() => {
    if (!topology) return;

    const visibleNodeIds = new Set<string>();

    const rfNodes: Node[] = topology.nodes
      .filter((node) => filters[node.type as NodeTypeFilter])
      .map((node) => {
        visibleNodeIds.add(node.id);
        let position;
        if (node.type === "core") position = CORE_POSITIONS[node.id] || CENTER;
        else if (node.type === "capability") position = CAPABILITY_POSITIONS[node.id] || CENTER;
        else if (node.type === "connector") position = CONNECTOR_POSITIONS[node.id] || CENTER;
        else position = getConfigPosition(node.id, node.parent || "core:config");

        return {
          id: node.id,
          type: node.type,
          position,
          data: { ...node },
        };
      });

    const maxVolume = Math.max(...topology.edges.map((e) => e.volume24h), 1);
    const rfEdges: Edge[] = topology.edges
      .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      .map((edge) => {
        const intensity = edge.volume24h / maxVolume;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "pulse",
          data: { active: edge.volume24h > 0, intensity },
          style: {
            stroke: FLOW_COLORS[edge.flowType] || "#333",
            strokeWidth: 1 + intensity * 2.5,
            opacity: edge.volume24h > 0 ? 0.3 : 0.08,
          },
        };
      });

    setFlowNodes(rfNodes);
    setFlowEdges(rfEdges);
  }, [topology, filters, setFlowNodes, setFlowEdges]);

  useEffect(() => {
    fetchTopology();
    const interval = setInterval(fetchTopology, 30000);
    return () => clearInterval(interval);
  }, [fetchTopology]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const topoNode = topology?.nodes.find((n) => n.id === node.id);
    if (topoNode) setSelectedNode(topoNode);
  }, [topology]);

  const rightSidebar = selectedNode ? (
    <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
  ) : undefined;

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center bg-[#06060a]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-[#D4A843]" />
            <span className="text-xs text-white/20 font-mono uppercase tracking-widest">Initializing Cortex</span>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell rightSidebar={rightSidebar}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 relative" style={{ background: "#06060a" }}>
          {/* Ambient floating particles */}
          <AmbientParticles />

          {/* Subtle radial gradient overlay */}
          <div
            className="absolute inset-0 pointer-events-none z-[1]"
            style={{
              background: "radial-gradient(ellipse at center, rgba(212,168,67,0.03) 0%, transparent 60%)",
            }}
          />

          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} color="#1a1a2e" gap={20} size={1} />
          </ReactFlow>

          {/* Filter toggles */}
          <FilterBar filters={filters} onToggle={toggleFilter} />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-10 bg-[#0a0a0f]/80 backdrop-blur-md rounded-lg p-3 text-xs space-y-1.5 border border-white/5">
            <div className="text-[10px] text-white/20 uppercase tracking-wider font-mono mb-1">Data Flow</div>
            {Object.entries(FLOW_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
                <span className="text-white/40 capitalize font-mono">{type}</span>
              </div>
            ))}
          </div>

          {/* Stats HUD */}
          {topology && <StatsHUD topology={topology} />}

          {/* Title overlay */}
          <div className="absolute top-4 left-4 z-10">
            <h1 className="text-lg font-bold text-white/10 font-mono uppercase tracking-[0.3em]">Cortex</h1>
          </div>
        </div>
        <ActivityTicker events={topology?.recentEvents || []} />
      </div>
    </AppShell>
  );
}
