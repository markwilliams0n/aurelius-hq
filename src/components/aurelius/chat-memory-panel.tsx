"use client";

import { useState } from "react";
import {
  Brain,
  HeartPulse,
  Sparkles,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type QuickResult = {
  success: boolean;
  message: string;
  timestamp: string;
};

export function ChatMemoryPanel() {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<QuickResult | null>(null);

  const runQuickHeartbeat = async () => {
    setHeartbeatRunning(true);
    try {
      const response = await fetch("/api/heartbeat", { method: "POST" });
      const data = await response.json();

      setLastHeartbeat({
        success: data.success ?? response.ok,
        message: data.success
          ? `${data.entitiesCreated} created, ${data.entitiesUpdated} updated`
          : data.error || "Failed",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      setLastHeartbeat({
        success: false,
        message: String(error),
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
            variant="outline"
            size="sm"
            className="w-full"
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
              className={`text-xs p-2 rounded ${
                lastHeartbeat.success
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              <div className="flex items-center gap-1">
                {lastHeartbeat.success ? (
                  <CheckCircle className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                {lastHeartbeat.message}
              </div>
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
