"use client";

import { useState } from "react";
import {
  Brain,
  HeartPulse,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  User,
  Building,
  FolderKanban,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type EntityDetail = {
  name: string;
  type: "person" | "company" | "project";
  facts: string[];
  action: "created" | "updated";
  source: string;
};

type HeartbeatResult = {
  success: boolean;
  entitiesCreated: number;
  entitiesUpdated: number;
  entities: EntityDetail[];
  extractionMethod?: "ollama" | "pattern";
  error?: string;
  timestamp: string;
};

export function ChatMemoryPanel() {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<HeartbeatResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const runQuickHeartbeat = async () => {
    setHeartbeatRunning(true);
    try {
      const response = await fetch("/api/heartbeat", { method: "POST" });
      const data = await response.json();

      setLastHeartbeat({
        success: data.success ?? response.ok,
        entitiesCreated: data.entitiesCreated ?? 0,
        entitiesUpdated: data.entitiesUpdated ?? 0,
        entities: data.entities ?? [],
        extractionMethod: data.extractionMethod,
        error: data.error,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      setLastHeartbeat({
        success: false,
        entitiesCreated: 0,
        entitiesUpdated: 0,
        entities: [],
        error: String(error),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setHeartbeatRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="font-serif text-lg text-gold flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Memory
        </h2>
      </div>

      {/* Quick Actions */}
      <div className="p-4 space-y-4">
        {/* Quick Heartbeat */}
        <div className="space-y-2">
          <Button
            onClick={runQuickHeartbeat}
            disabled={heartbeatRunning}
            size="sm"
            className="w-full bg-gold hover:bg-gold-bright text-primary-foreground"
          >
            {heartbeatRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <HeartPulse className="w-4 h-4 mr-2" />
                Quick Heartbeat
              </>
            )}
          </Button>

          {lastHeartbeat && (
            <div
              className={`text-xs rounded border ${
                lastHeartbeat.success
                  ? "bg-green-500/5 border-green-500/30"
                  : "bg-red-500/5 border-red-500/30"
              }`}
            >
              {/* Summary header */}
              <div className="p-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {lastHeartbeat.success ? (
                    <CheckCircle className="w-3 h-3 text-green-500" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-red-500" />
                  )}
                  <span className={lastHeartbeat.success ? "text-green-400" : "text-red-400"}>
                    {lastHeartbeat.entitiesCreated} created, {lastHeartbeat.entitiesUpdated} updated
                  </span>
                </div>
                {lastHeartbeat.extractionMethod && (
                  <span className={`px-1 py-0.5 rounded text-[10px] ${
                    lastHeartbeat.extractionMethod === "ollama"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-gray-500/20 text-gray-400"
                  }`}>
                    {lastHeartbeat.extractionMethod === "ollama" ? "LLM" : "Pattern"}
                  </span>
                )}
              </div>

              {/* Entity details */}
              {lastHeartbeat.entities && lastHeartbeat.entities.length > 0 && (
                <div className="border-t border-border/50">
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full px-2 py-1.5 text-left text-muted-foreground hover:text-foreground flex items-center justify-between"
                  >
                    <span>{lastHeartbeat.entities.length} entities</span>
                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {expanded && (
                    <div className="px-2 pb-2 space-y-1.5 max-h-60 overflow-y-auto">
                      {lastHeartbeat.entities.map((entity, i) => {
                        const TypeIcon = entity.type === "person" ? User
                          : entity.type === "company" ? Building
                          : FolderKanban;
                        return (
                          <div key={i} className="p-1.5 rounded bg-background/50 border border-border/50">
                            <div className="flex items-center gap-1.5">
                              <TypeIcon className="w-3 h-3 text-muted-foreground" />
                              <span className="text-gold font-medium truncate">{entity.name}</span>
                              <span className={`ml-auto px-1 py-0.5 rounded text-[9px] ${
                                entity.action === "created"
                                  ? "bg-green-500/20 text-green-400"
                                  : "bg-blue-500/20 text-blue-400"
                              }`}>
                                {entity.action}
                              </span>
                            </div>
                            {entity.facts.length > 0 && (
                              <div className="mt-1 pl-4 text-[10px] text-muted-foreground">
                                {entity.facts.slice(0, 2).map((fact, j) => (
                                  <div key={j} className="truncate">• {fact}</div>
                                ))}
                                {entity.facts.length > 2 && (
                                  <div className="text-muted-foreground/50">+{entity.facts.length - 2} more</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Error display */}
              {lastHeartbeat.error && (
                <div className="p-2 border-t border-red-500/30 text-red-400">
                  {lastHeartbeat.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Links */}
        <div className="space-y-2">
          <Link href="/system">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              <Sparkles className="w-4 h-4 mr-2" />
              System Activity
              <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
            </Button>
          </Link>
          <Link href="/memory">
            <Button variant="ghost" size="sm" className="w-full justify-start">
              <Brain className="w-4 h-4 mr-2" />
              Browse Memory
              <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Info */}
      <div className="mt-auto p-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Memory is automatically recalled during conversations. Run heartbeat
          to process new daily notes.
        </p>
      </div>
    </div>
  );
}
