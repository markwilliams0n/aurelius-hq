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
  Activity,
  RefreshCw,
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

type HeartbeatResult = {
  id: string;
  type: "heartbeat";
  success: boolean;
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  timestamp: string;
  duration?: number;
  error?: string;
  entities?: EntityDetail[];
  extractionMethod?: "ollama" | "pattern";
};

type SynthesisResult = {
  id: string;
  type: "synthesis";
  success: boolean;
  entitiesProcessed: number;
  factsArchived: number;
  summariesRegenerated: number;
  timestamp: string;
  duration?: number;
  error?: string;
};

type ActivityEntry = HeartbeatResult | SynthesisResult;

export default function SystemPage() {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load activity log on mount
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

      toast.success(`Heartbeat complete: ${data.entitiesCreated ?? 0} created, ${data.entitiesUpdated ?? 0} updated`);

      // Reload activity log to get the persisted entry
      await loadActivityLog();
    } catch (error) {
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

      toast.success(`Synthesis complete: ${data.factsArchived ?? 0} facts archived`);

      // Reload activity log to get the persisted entry
      await loadActivityLog();
    } catch (error) {
      toast.error("Synthesis failed");
      await loadActivityLog();
    } finally {
      setSynthesisRunning(false);
    }
  };

  const copyHeartbeatToClipboard = async (result: HeartbeatResult) => {
    const output = formatHeartbeatForCopy(result);
    await navigator.clipboard.writeText(output);
    setCopiedId(result.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied to clipboard");
  };

  const clearResults = async () => {
    try {
      await fetch("/api/activity", { method: "DELETE" });
      setActivityLog([]);
      toast.success("Cleared activity log");
    } catch (error) {
      toast.error("Failed to clear activity log");
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">System</h1>
          <p className="text-sm text-muted-foreground">
            Monitor and control memory system operations
          </p>
        </div>

        <div className="p-6 space-y-8">
          {/* Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Heartbeat Control */}
            <div className="p-4 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                  <HeartPulse className="w-5 h-5 text-gold" />
                </div>
                <div>
                  <h3 className="font-medium">Heartbeat</h3>
                  <p className="text-xs text-muted-foreground">
                    Extract entities from daily notes
                  </p>
                </div>
              </div>
              <Button
                onClick={runHeartbeat}
                disabled={heartbeatRunning || synthesisRunning}
                className="w-full"
              >
                {heartbeatRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Run Heartbeat
                  </>
                )}
              </Button>
            </div>

            {/* Synthesis Control */}
            <div className="p-4 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-medium">Synthesis</h3>
                  <p className="text-xs text-muted-foreground">
                    Process memory decay and archive cold facts
                  </p>
                </div>
              </div>
              <Button
                onClick={runSynthesis}
                disabled={synthesisRunning || heartbeatRunning}
                variant="outline"
                className="w-full"
              >
                {synthesisRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Run Synthesis
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Activity Log */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-gold">Activity Log</h2>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={loadActivityLog}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
                {activityLog.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearResults}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                <p>Loading activity log...</p>
              </div>
            ) : activityLog.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No activity yet. Run heartbeat or synthesis to see results.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activityLog.map((entry) =>
                  entry.type === "heartbeat" ? (
                    <HeartbeatResultCard
                      key={entry.id}
                      result={entry as HeartbeatResult}
                      onCopy={() => copyHeartbeatToClipboard(entry as HeartbeatResult)}
                      copied={copiedId === entry.id}
                    />
                  ) : (
                    <SynthesisResultCard key={entry.id} result={entry as SynthesisResult} />
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function formatHeartbeatForCopy(result: HeartbeatResult): string {
  const lines: string[] = [
    "# Heartbeat Report",
    "",
    `**Timestamp:** ${result.timestamp}`,
    `**Status:** ${result.success ? "Success" : "Failed"}`,
    `**Extraction Method:** ${result.extractionMethod || "unknown"}`,
    `**Duration:** ${result.duration ? `${result.duration}ms` : "unknown"}`,
    "",
    "## Summary",
    `- Entities Created: ${result.entitiesCreated}`,
    `- Entities Updated: ${result.entitiesUpdated}`,
    `- Reindexed: ${result.reindexed ? "Yes" : "No"}`,
    "",
  ];

  if (result.error) {
    lines.push("## Error", result.error, "");
  }

  if (result.entities && result.entities.length > 0) {
    lines.push("## Entities Extracted", "");

    for (const entity of result.entities) {
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

function HeartbeatResultCard({
  result,
  onCopy,
  copied,
}: {
  result: HeartbeatResult;
  onCopy: () => void;
  copied: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className={`rounded-lg border ${
        result.success
          ? "bg-green-500/5 border-green-500/30"
          : "bg-red-500/5 border-red-500/30"
      }`}
    >
      {/* Header */}
      <div className="p-4 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              result.success ? "bg-green-500/20" : "bg-red-500/20"
            }`}
          >
            {result.success ? (
              <HeartPulse className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Heartbeat</span>
              {result.extractionMethod && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    result.extractionMethod === "ollama"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-gray-500/20 text-gray-400"
                  }`}
                >
                  {result.extractionMethod === "ollama" ? "LLM" : "Pattern"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(result.timestamp).toLocaleString()}
              </span>
              {result.duration && <span>{result.duration}ms</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-3 gap-4 p-3 rounded-lg bg-background/50">
          <div className="text-center">
            <div className="text-2xl font-bold text-gold">
              {result.entitiesCreated}
            </div>
            <div className="text-xs text-muted-foreground">Created</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gold">
              {result.entitiesUpdated}
            </div>
            <div className="text-xs text-muted-foreground">Updated</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gold">
              {result.reindexed ? "Yes" : "No"}
            </div>
            <div className="text-xs text-muted-foreground">Reindexed</div>
          </div>
        </div>
      </div>

      {/* Entities */}
      {result.entities && result.entities.length > 0 && (
        <div className="border-t border-border/50">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-4 py-2 text-left text-sm text-muted-foreground hover:text-foreground flex items-center justify-between"
          >
            <span>{result.entities.length} entities extracted</span>
            <span>{expanded ? "−" : "+"}</span>
          </button>

          {expanded && (
            <div className="px-4 pb-4 space-y-2">
              {result.entities.map((entity, i) => (
                <EntityCard key={i} entity={entity} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {result.error && (
        <div className="px-4 pb-4">
          <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
            {result.error}
          </div>
        </div>
      )}
    </div>
  );
}

function EntityCard({ entity }: { entity: EntityDetail }) {
  const TypeIcon =
    entity.type === "person"
      ? User
      : entity.type === "company"
      ? Building
      : FolderKanban;

  return (
    <div className="p-3 rounded-lg bg-background/50 border border-border/50">
      <div className="flex items-center gap-2 mb-2">
        <TypeIcon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-gold">{entity.name}</span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${
            entity.action === "created"
              ? "bg-green-500/20 text-green-400"
              : "bg-blue-500/20 text-blue-400"
          }`}
        >
          {entity.action}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {entity.source}
        </span>
      </div>
      {entity.facts.length > 0 && (
        <ul className="text-sm text-muted-foreground space-y-1 ml-6">
          {entity.facts.map((fact, i) => (
            <li key={i}>• {fact}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SynthesisResultCard({ result }: { result: SynthesisResult }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        result.success
          ? "bg-purple-500/5 border-purple-500/30"
          : "bg-red-500/5 border-red-500/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            result.success ? "bg-purple-500/20" : "bg-red-500/20"
          }`}
        >
          {result.success ? (
            <Sparkles className="w-4 h-4 text-purple-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-500" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="font-medium">Synthesis</span>
            <span className="text-sm text-muted-foreground">
              {new Date(result.timestamp).toLocaleString()}
            </span>
          </div>

          {result.success ? (
            <div className="grid grid-cols-3 gap-4 mt-3 p-3 rounded-lg bg-background/50">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {result.entitiesProcessed}
                </div>
                <div className="text-xs text-muted-foreground">Processed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {result.factsArchived}
                </div>
                <div className="text-xs text-muted-foreground">Archived</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {result.summariesRegenerated}
                </div>
                <div className="text-xs text-muted-foreground">Regenerated</div>
              </div>
            </div>
          ) : (
            <div className="mt-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              {result.error || "Unknown error"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
