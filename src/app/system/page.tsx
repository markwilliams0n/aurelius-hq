"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { PendingChanges } from "@/components/aurelius/pending-changes";
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

type StepProgress = {
  step: string;
  status: "start" | "done" | "skip" | "error";
  detail?: string;
};

const STEP_LABELS: Record<string, string> = {
  backup: "Backup",
  extraction: "Entity extraction",
  granola: "Granola sync",
  gmail: "Gmail sync",
  linear: "Linear sync",
  slack: "Slack",
  qmd_update: "Search index",
  qmd_embed: "Embeddings",
};

type EntityDetail = {
  name: string;
  type: "person" | "company" | "project";
  facts: string[];
  action: "created" | "updated";
  source: string;
};

type StepDetail = {
  success: boolean;
  durationMs: number;
  error?: string;
};

type ConnectorResult = {
  synced?: number;
  skipped?: number;
  errors?: number;
  archived?: number;
  error?: string;
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
  steps?: Record<string, StepDetail>;
  gmail?: ConnectorResult;
  granola?: ConnectorResult;
  linear?: ConnectorResult;
  slack?: ConnectorResult;
  warnings?: string[];
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

type TriageEntry = {
  id: string;
  type: "triage";
  action: string;
  message: string;
  timestamp: string;
};

type ActivityEntry = HeartbeatEntry | SynthesisEntry | SessionEntry | SystemEntry | TriageEntry;

export default function SystemPage() {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTriageActions, setShowTriageActions] = useState(false);
  const [heartbeatSteps, setHeartbeatSteps] = useState<StepProgress[]>([]);

  useEffect(() => {
    loadActivityLog();
  }, []);

  const loadActivityLog = async () => {
    try {
      const response = await fetch("/api/activity");
      const data = await response.json();
      // Transform database activities to the expected format
      const entries = (data.activities || []).map((a: any) => {
        // Map eventType to entry type
        if (a.eventType === 'heartbeat_run') {
          return {
            id: a.id,
            type: 'heartbeat' as const,
            trigger: a.metadata?.trigger || 'manual',
            success: a.metadata?.success ?? true,
            entitiesCreated: a.metadata?.entitiesCreated || 0,
            entitiesUpdated: a.metadata?.entitiesUpdated || 0,
            reindexed: a.metadata?.reindexed ?? false,
            entities: a.metadata?.entities || [],
            extractionMethod: a.metadata?.extractionMethod,
            steps: a.metadata?.steps,
            gmail: a.metadata?.gmail,
            granola: a.metadata?.granola,
            linear: a.metadata?.linear,
            slack: a.metadata?.slack,
            warnings: a.metadata?.warnings,
            duration: a.metadata?.duration,
            timestamp: a.createdAt,
            error: a.metadata?.error,
          };
        }
        if (a.eventType === 'synthesis_run') {
          return {
            id: a.id,
            type: 'synthesis' as const,
            trigger: a.metadata?.trigger || 'manual',
            success: a.metadata?.success ?? true,
            entitiesProcessed: a.metadata?.entitiesProcessed || 0,
            factsArchived: a.metadata?.factsArchived || 0,
            summariesRegenerated: a.metadata?.summariesRegenerated || 0,
            duration: a.metadata?.duration,
            timestamp: a.createdAt,
            error: a.metadata?.error,
          };
        }
        // Triage actions get their own type (hidden by default)
        if (a.eventType === 'triage_action') {
          return {
            id: a.id,
            type: 'triage' as const,
            action: a.eventType,
            message: a.description,
            timestamp: a.createdAt,
          };
        }
        // Generic system/other entries
        return {
          id: a.id,
          type: 'system' as const,
          action: a.eventType,
          message: a.description,
          timestamp: a.createdAt,
        };
      });
      setActivityLog(entries);
    } catch (error) {
      console.error("Failed to load activity log:", error);
    } finally {
      setLoading(false);
    }
  };

  const runHeartbeat = async () => {
    setHeartbeatRunning(true);
    setHeartbeatSteps([]);
    try {
      const response = await fetch("/api/heartbeat/stream", { method: "POST" });
      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine);

            if (event.done) {
              // Final event
              if (event.result) {
                toast.success(
                  `Heartbeat: ${event.result.entitiesCreated ?? 0} created, ${event.result.entitiesUpdated ?? 0} updated`
                );
              } else if (event.error) {
                toast.error("Heartbeat failed");
              }
            } else if (event.step) {
              // Progress event
              setHeartbeatSteps((prev) => {
                // Update existing step or add new one
                const existing = prev.findIndex((s) => s.step === event.step);
                if (existing >= 0) {
                  const updated = [...prev];
                  updated[existing] = event;
                  return updated;
                }
                return [...prev, event];
              });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

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
          {/* Pending Config Changes */}
          <PendingChanges />

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

          {/* Heartbeat Progress Ticker */}
          {heartbeatSteps.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HeartPulse className="w-4 h-4 text-gold" />
                {heartbeatRunning ? "Heartbeat running..." : "Heartbeat complete"}
              </div>
              <div className="space-y-1">
                {heartbeatSteps.map((s) => (
                  <div key={s.step} className="flex items-center gap-2 text-sm">
                    {s.status === "start" ? (
                      <Loader2 className="w-3.5 h-3.5 text-gold animate-spin shrink-0" />
                    ) : s.status === "done" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    ) : s.status === "skip" ? (
                      <span className="w-3.5 h-3.5 text-center text-muted-foreground shrink-0">—</span>
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    )}
                    <span className={s.status === "start" ? "text-foreground" : "text-muted-foreground"}>
                      {STEP_LABELS[s.step] || s.step}
                    </span>
                    {s.detail && (
                      <span className="text-xs text-muted-foreground/70 truncate">
                        {s.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity Feed */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-gold">Activity Feed</h2>
              {(() => {
                const triageCount = activityLog.filter(e => e.type === "triage").length;
                if (triageCount === 0) return null;
                return (
                  <button
                    onClick={() => setShowTriageActions(!showTriageActions)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      showTriageActions
                        ? "border-muted-foreground/30 text-muted-foreground bg-secondary"
                        : "border-border text-muted-foreground/60 hover:text-muted-foreground hover:border-muted-foreground/30"
                    }`}
                  >
                    {showTriageActions ? "Hide" : "Show"} triage actions ({triageCount})
                  </button>
                );
              })()}
            </div>

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
                {activityLog
                  .filter(entry => showTriageActions || entry.type !== "triage")
                  .map((entry) => (
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
      case "triage":
        return <Settings className="w-4 h-4" />;
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
      case "triage":
        return "text-muted-foreground/50";
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
      case "triage": {
        const e = entry as TriageEntry;
        return <span className="truncate">{e.message}</span>;
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
          {entry.type === "triage" && <SystemDetails entry={entry as unknown as SystemEntry} />}
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
  const [expandedEntities, setExpandedEntities] = useState(false);

  const formatMs = (ms: number) => {
    if (ms >= 60000) return `${(ms / 1000).toFixed(0)}s`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{new Date(entry.timestamp).toLocaleString()}</span>
        </div>
        {entry.duration != null && (
          <span className="text-muted-foreground">{formatMs(entry.duration)}</span>
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

      {/* Steps breakdown */}
      {entry.steps && Object.keys(entry.steps).length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-1">Steps</div>
          {Object.entries(entry.steps).map(([key, step]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              {step.success ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              )}
              <span className="text-muted-foreground">
                {STEP_LABELS[key] || key}
              </span>
              <span className="text-xs text-muted-foreground/50">
                {formatMs(step.durationMs)}
              </span>
              {step.error && (
                <span className="text-xs text-red-400 truncate ml-auto max-w-[200px]" title={step.error}>
                  {step.error.slice(0, 60)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Connector results */}
      {(entry.gmail || entry.granola || entry.linear || entry.slack) && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-1">Connectors</div>
          <div className="grid grid-cols-2 gap-2">
            {entry.gmail && (
              <ConnectorStat
                label="Gmail"
                synced={entry.gmail.synced}
                archived={entry.gmail.archived}
                skipped={entry.gmail.skipped}
                errors={entry.gmail.errors}
                error={entry.gmail.error}
              />
            )}
            {entry.granola && (
              <ConnectorStat
                label="Granola"
                synced={entry.granola.synced}
                skipped={entry.granola.skipped}
                errors={entry.granola.errors}
                error={entry.granola.error}
              />
            )}
            {entry.linear && (
              <ConnectorStat
                label="Linear"
                synced={entry.linear.synced}
                skipped={entry.linear.skipped}
                errors={entry.linear.errors}
                error={entry.linear.error}
              />
            )}
            {entry.slack && (
              <ConnectorStat
                label="Slack"
                synced={entry.slack.synced}
                error={entry.slack.error}
              />
            )}
          </div>
        </div>
      )}

      {/* Warnings */}
      {entry.warnings && entry.warnings.length > 0 && (
        <div className="space-y-1">
          {entry.warnings.map((w, i) => (
            <div key={i} className="p-2 rounded bg-yellow-500/10 text-yellow-400 text-xs flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {entry.error && !entry.warnings?.length && (
        <div className="p-2 rounded bg-red-500/10 text-red-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{entry.error}</span>
        </div>
      )}

      {/* Entities */}
      {entry.entities && entry.entities.length > 0 && (
        <div className="space-y-1.5">
          <button
            onClick={() => setExpandedEntities(!expandedEntities)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${expandedEntities ? "rotate-90" : ""}`} />
            {entry.entities.length} entities ({entry.entitiesCreated} created, {entry.entitiesUpdated} updated)
          </button>
          {expandedEntities && (
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {entry.entities.map((entity, i) => (
                <EntityCard key={i} entity={entity} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* No entities message */}
      {(!entry.entities || entry.entities.length === 0) && entry.entitiesCreated === 0 && entry.entitiesUpdated === 0 && (
        <div className="text-xs text-muted-foreground/50 italic">
          No new entities or facts extracted
        </div>
      )}
    </div>
  );
}

function ConnectorStat({
  label,
  synced,
  archived,
  skipped,
  errors,
  error,
}: {
  label: string;
  synced?: number;
  archived?: number;
  skipped?: number;
  errors?: number;
  error?: string;
}) {
  const parts: string[] = [];
  if (synced) parts.push(`${synced} synced`);
  if (archived) parts.push(`${archived} archived`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (errors) parts.push(`${errors} errors`);

  return (
    <div className={`p-2 rounded text-xs ${error ? "bg-red-500/10 border border-red-500/20" : "bg-secondary/50"}`}>
      <div className="font-medium text-sm">{label}</div>
      {parts.length > 0 ? (
        <div className="text-muted-foreground">{parts.join(", ")}</div>
      ) : error ? (
        <div className="text-red-400 truncate" title={error}>{error}</div>
      ) : (
        <div className="text-muted-foreground/50">No changes</div>
      )}
    </div>
  );
}

function EntityCard({ entity }: { entity: EntityDetail }) {
  const [showFacts, setShowFacts] = useState(false);
  const TypeIcon =
    entity.type === "person" ? User : entity.type === "company" ? Building : FolderKanban;

  return (
    <div className="p-2 rounded bg-secondary/30 border border-border/30">
      <div className="flex items-center gap-2">
        <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm text-gold font-medium">{entity.name}</span>
        <span className={`text-[10px] px-1 py-0.5 rounded ${
          entity.action === "created"
            ? "bg-green-500/20 text-green-400"
            : "bg-blue-500/20 text-blue-400"
        }`}>
          {entity.action}
        </span>
        {entity.facts.length > 0 && (
          <button
            onClick={() => setShowFacts(!showFacts)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showFacts ? "rotate-90" : ""}`} />
            {entity.facts.length} fact{entity.facts.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>
      {showFacts && entity.facts.length > 0 && (
        <div className="mt-1.5 pl-6 space-y-0.5">
          {entity.facts.map((fact, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              • {fact}
            </div>
          ))}
          {entity.source && (
            <div className="text-[10px] text-muted-foreground/50 mt-1">
              Source: {entity.source}
            </div>
          )}
        </div>
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
