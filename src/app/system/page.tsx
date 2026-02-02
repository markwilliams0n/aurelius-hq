"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import {
  HeartPulse,
  Sparkles,
  Play,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle,
  User,
  Building,
  FolderKanban,
  Clock,
  Trash2,
  RefreshCw,
  ChevronRight,
  MessageSquare,
  Zap,
  Calendar,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type EntityDetail = {
  name: string;
  type: "person" | "company" | "project";
  facts: string[];
  action: "created" | "updated";
  source: string;
};

type HeartbeatEntry = {
  id: string;
  type: "heartbeat";
  trigger: "manual" | "auto" | "scheduled";
  success: boolean;
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  entities?: EntityDetail[];
  extractionMethod?: "ollama" | "pattern";
  duration?: number;
  timestamp: string;
  error?: string;
};

type SynthesisEntry = {
  id: string;
  type: "synthesis";
  trigger: "manual" | "auto" | "scheduled";
  success: boolean;
  entitiesProcessed: number;
  factsArchived: number;
  summariesRegenerated: number;
  duration?: number;
  timestamp: string;
  error?: string;
};

type SessionEntry = {
  id: string;
  type: "session";
  action: "started" | "ended";
  conversationId?: string;
  timestamp: string;
};

type SystemEntry = {
  id: string;
  type: "system";
  action: "startup" | "shutdown" | "error" | "config_change";
  message: string;
  timestamp: string;
};

type ActivityEntry = HeartbeatEntry | SynthesisEntry | SessionEntry | SystemEntry;

export default function SystemPage() {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadActivityLog();
  }, []);

  const loadActivityLog = async () => {
    try {
      const response = await fetch("/api/activity");
      const data = await response.json();
      setActivityLog(data.entries || []);
    } catch (error) {
      console.error("Failed to load activity log:", error);
    } finally {
      setLoading(false);
    }
  };

  const runHeartbeat = async () => {
    setHeartbeatRunning(true);
    try {
      const response = await fetch("/api/heartbeat", { method: "POST" });
      const data = await response.json();
      toast.success(`Heartbeat: ${data.entitiesCreated ?? 0} created, ${data.entitiesUpdated ?? 0} updated`);
      await loadActivityLog();
    } catch {
      toast.error("Heartbeat failed");
      await loadActivityLog();
    } finally {
      setHeartbeatRunning(false);
    }
  };

  const runSynthesis = async () => {
    setSynthesisRunning(true);
    try {
      const response = await fetch("/api/synthesis", { method: "POST" });
      const data = await response.json();
      toast.success(`Synthesis: ${data.factsArchived ?? 0} facts archived`);
      await loadActivityLog();
    } catch {
      toast.error("Synthesis failed");
      await loadActivityLog();
    } finally {
      setSynthesisRunning(false);
    }
  };

  const clearResults = async () => {
    try {
      await fetch("/api/activity", { method: "DELETE" });
      setActivityLog([]);
      toast.success("Cleared activity log");
    } catch {
      toast.error("Failed to clear activity log");
    }
  };

  const copyToClipboard = async (entry: HeartbeatEntry) => {
    const output = formatHeartbeatForCopy(entry);
    await navigator.clipboard.writeText(output);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied to clipboard");
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">System</h1>
          <p className="text-sm text-muted-foreground">
            Memory system control center
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Quick Actions */}
          <div className="flex gap-3">
            <Button
              onClick={runHeartbeat}
              disabled={heartbeatRunning || synthesisRunning}
              size="sm"
              className="bg-gold hover:bg-gold-bright text-primary-foreground"
            >
              {heartbeatRunning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <HeartPulse className="w-4 h-4 mr-2" />
              )}
              Heartbeat
            </Button>
            <Button
              onClick={runSynthesis}
              disabled={synthesisRunning || heartbeatRunning}
              size="sm"
              variant="outline"
            >
              {synthesisRunning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Synthesis
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={loadActivityLog}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              {activityLog.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearResults}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Activity Feed */}
          <div>
            <h2 className="font-serif text-lg text-gold mb-4">Activity Feed</h2>

            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-50" />
                <p className="text-sm">Loading...</p>
              </div>
            ) : activityLog.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
                <p className="text-sm">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {activityLog.map((entry) => (
                  <FeedItem
                    key={entry.id}
                    entry={entry}
                    expanded={expandedId === entry.id}
                    onToggle={() => toggleExpand(entry.id)}
                    onCopy={entry.type === "heartbeat" ? () => copyToClipboard(entry as HeartbeatEntry) : undefined}
                    copied={copiedId === entry.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FeedItem({
  entry,
  expanded,
  onToggle,
  onCopy,
  copied,
}: {
  entry: ActivityEntry;
  expanded: boolean;
  onToggle: () => void;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const getIcon = () => {
    switch (entry.type) {
      case "heartbeat":
        return <HeartPulse className="w-4 h-4" />;
      case "synthesis":
        return <Sparkles className="w-4 h-4" />;
      case "session":
        return <MessageSquare className="w-4 h-4" />;
      case "system":
        return <Settings className="w-4 h-4" />;
    }
  };

  const getIconColor = () => {
    if ("success" in entry && !entry.success) return "text-red-500";
    switch (entry.type) {
      case "heartbeat":
        return "text-gold";
      case "synthesis":
        return "text-purple-400";
      case "session":
        return "text-blue-400";
      case "system":
        return "text-muted-foreground";
    }
  };

  const getTriggerIcon = () => {
    if (!("trigger" in entry)) return null;
    switch (entry.trigger) {
      case "auto":
        return <Zap className="w-3 h-3 text-yellow-500" />;
      case "scheduled":
        return <Calendar className="w-3 h-3 text-blue-400" />;
      default:
        return null;
    }
  };

  const getSummary = () => {
    switch (entry.type) {
      case "heartbeat": {
        const e = entry as HeartbeatEntry;
        if (!e.success) return <span className="text-red-400">Failed</span>;
        return (
          <span>
            <span className="text-gold">{e.entitiesCreated}</span> created,{" "}
            <span className="text-gold">{e.entitiesUpdated}</span> updated
          </span>
        );
      }
      case "synthesis": {
        const e = entry as SynthesisEntry;
        if (!e.success) return <span className="text-red-400">Failed</span>;
        return (
          <span>
            <span className="text-purple-400">{e.factsArchived}</span> archived
          </span>
        );
      }
      case "session": {
        const e = entry as SessionEntry;
        return <span>Session {e.action}</span>;
      }
      case "system": {
        const e = entry as SystemEntry;
        return <span className="truncate">{e.message}</span>;
      }
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Compact row */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className={`${getIconColor()}`}>{getIcon()}</div>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="font-medium text-sm capitalize">{entry.type}</span>
          {getTriggerIcon()}
          {"extractionMethod" in entry && entry.extractionMethod && (
            <span className={`text-[10px] px-1 py-0.5 rounded ${
              entry.extractionMethod === "ollama"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-gray-500/20 text-gray-400"
            }`}>
              {entry.extractionMethod === "ollama" ? "LLM" : "Pattern"}
            </span>
          )}
          <span className="text-muted-foreground text-sm">—</span>
          <span className="text-sm text-muted-foreground truncate">{getSummary()}</span>
        </div>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(entry.timestamp)}
        </span>

        <ChevronRight
          className={`w-4 h-4 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 bg-background/50">
          {entry.type === "heartbeat" && (
            <HeartbeatDetails entry={entry as HeartbeatEntry} onCopy={onCopy} copied={copied} />
          )}
          {entry.type === "synthesis" && <SynthesisDetails entry={entry as SynthesisEntry} />}
          {entry.type === "session" && <SessionDetails entry={entry as SessionEntry} />}
          {entry.type === "system" && <SystemDetails entry={entry as SystemEntry} />}
        </div>
      )}
    </div>
  );
}

function HeartbeatDetails({
  entry,
  onCopy,
  copied,
}: {
  entry: HeartbeatEntry;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
        {entry.duration && (
          <span className="text-muted-foreground">{entry.duration}ms</span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-xs ${
          entry.trigger === "manual"
            ? "bg-secondary text-muted-foreground"
            : entry.trigger === "auto"
            ? "bg-yellow-500/20 text-yellow-500"
            : "bg-blue-500/20 text-blue-400"
        }`}>
          {entry.trigger}
        </span>
        {onCopy && (
          <button onClick={onCopy} className="ml-auto p-1 hover:bg-secondary rounded">
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-gold">{entry.entitiesCreated}</div>
          <div className="text-xs text-muted-foreground">Created</div>
        </div>
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-gold">{entry.entitiesUpdated}</div>
          <div className="text-xs text-muted-foreground">Updated</div>
        </div>
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-gold">{entry.reindexed ? "Yes" : "No"}</div>
          <div className="text-xs text-muted-foreground">Reindexed</div>
        </div>
      </div>

      {/* Error */}
      {entry.error && (
        <div className="p-2 rounded bg-red-500/10 text-red-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{entry.error}</span>
        </div>
      )}

      {/* Entities */}
      {entry.entities && entry.entities.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">
            {entry.entities.length} entities extracted
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {entry.entities.map((entity, i) => (
              <EntityRow key={i} entity={entity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EntityRow({ entity }: { entity: EntityDetail }) {
  const TypeIcon =
    entity.type === "person" ? User : entity.type === "company" ? Building : FolderKanban;

  return (
    <div className="flex items-center gap-2 p-1.5 rounded bg-secondary/30 text-sm">
      <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-gold font-medium">{entity.name}</span>
      <span className={`text-[10px] px-1 py-0.5 rounded ${
        entity.action === "created"
          ? "bg-green-500/20 text-green-400"
          : "bg-blue-500/20 text-blue-400"
      }`}>
        {entity.action}
      </span>
      {entity.facts.length > 0 && (
        <span className="text-xs text-muted-foreground ml-auto">
          {entity.facts.length} fact{entity.facts.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

function SynthesisDetails({ entry }: { entry: SynthesisEntry }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
        {entry.duration && (
          <span className="text-muted-foreground">{entry.duration}ms</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-purple-400">{entry.entitiesProcessed}</div>
          <div className="text-xs text-muted-foreground">Processed</div>
        </div>
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-purple-400">{entry.factsArchived}</div>
          <div className="text-xs text-muted-foreground">Archived</div>
        </div>
        <div className="p-2 rounded bg-secondary/50 text-center">
          <div className="text-lg font-bold text-purple-400">{entry.summariesRegenerated}</div>
          <div className="text-xs text-muted-foreground">Regenerated</div>
        </div>
      </div>

      {entry.error && (
        <div className="p-2 rounded bg-red-500/10 text-red-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{entry.error}</span>
        </div>
      )}
    </div>
  );
}

function SessionDetails({ entry }: { entry: SessionEntry }) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span>{new Date(entry.timestamp).toLocaleString()}</span>
      </div>
      {entry.conversationId && (
        <div className="mt-2 text-xs text-muted-foreground">
          Conversation: {entry.conversationId}
        </div>
      )}
    </div>
  );
}

function SystemDetails({ entry }: { entry: SystemEntry }) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span>{new Date(entry.timestamp).toLocaleString()}</span>
      </div>
      <div className="mt-2 text-muted-foreground">{entry.message}</div>
    </div>
  );
}

function formatHeartbeatForCopy(entry: HeartbeatEntry): string {
  const lines: string[] = [
    "# Heartbeat Report",
    "",
    `**Timestamp:** ${entry.timestamp}`,
    `**Trigger:** ${entry.trigger}`,
    `**Status:** ${entry.success ? "Success" : "Failed"}`,
    `**Extraction Method:** ${entry.extractionMethod || "unknown"}`,
    `**Duration:** ${entry.duration ? `${entry.duration}ms` : "unknown"}`,
    "",
    "## Summary",
    `- Entities Created: ${entry.entitiesCreated}`,
    `- Entities Updated: ${entry.entitiesUpdated}`,
    `- Reindexed: ${entry.reindexed ? "Yes" : "No"}`,
    "",
  ];

  if (entry.error) {
    lines.push("## Error", entry.error, "");
  }

  if (entry.entities && entry.entities.length > 0) {
    lines.push("## Entities Extracted", "");
    for (const entity of entry.entities) {
      lines.push(`### ${entity.name} (${entity.type}) - ${entity.action}`);
      lines.push(`Source: ${entity.source}`);
      if (entity.facts.length > 0) {
        lines.push("Facts:");
        for (const fact of entity.facts) {
          lines.push(`- ${fact}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
