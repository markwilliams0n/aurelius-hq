"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Check,
  X,
  Clock,
  ChevronRight,
  Loader2,
  FileText,
  Diff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type PendingChange = {
  id: string;
  key: string;
  currentContent: string | null;
  proposedContent: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export function PendingChanges() {
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    loadChanges();
  }, []);

  const loadChanges = async () => {
    try {
      const response = await fetch("/api/config/pending");
      const data = await response.json();
      setChanges(data.pending || []);
    } catch (error) {
      console.error("Failed to load pending changes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setProcessingId(id);
    try {
      const response = await fetch(`/api/config/pending/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        toast.success(action === "approve" ? "Change approved" : "Change rejected");
        await loadChanges();
      } else {
        toast.error("Failed to process change");
      }
    } catch {
      toast.error("Failed to process change");
    } finally {
      setProcessingId(null);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <Loader2 className="w-5 h-5 mx-auto animate-spin" />
      </div>
    );
  }

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="font-serif text-lg text-gold flex items-center gap-2">
        <Settings className="w-5 h-5" />
        Pending Config Changes
      </h3>

      <div className="space-y-2">
        {changes.map((change) => (
          <div
            key={change.id}
            className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 overflow-hidden"
          >
            {/* Header row */}
            <button
              onClick={() => setExpandedId(expandedId === change.id ? null : change.id)}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-yellow-500/10 transition-colors text-left"
            >
              <FileText className="w-4 h-4 text-yellow-500" />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{change.key}</span>
                <span className="text-muted-foreground text-sm ml-2">—</span>
                <span className="text-sm text-muted-foreground ml-2 truncate">
                  {change.reason}
                </span>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatTime(change.createdAt)}
              </span>
              <ChevronRight
                className={`w-4 h-4 text-muted-foreground transition-transform ${
                  expandedId === change.id ? "rotate-90" : ""
                }`}
              />
            </button>

            {/* Expanded content */}
            {expandedId === change.id && (
              <div className="px-3 pb-3 pt-1 border-t border-yellow-500/20 space-y-3">
                {/* Reason */}
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">
                    Why this change:
                  </div>
                  <p className="text-sm">{change.reason}</p>
                </div>

                {/* Diff view */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Current */}
                  <div>
                    <div className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500/50" />
                      Current
                    </div>
                    <pre className="text-xs p-2 rounded bg-background/50 border border-border overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {change.currentContent || "(not set)"}
                    </pre>
                  </div>

                  {/* Proposed */}
                  <div>
                    <div className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500/50" />
                      Proposed
                    </div>
                    <pre className="text-xs p-2 rounded bg-background/50 border border-border overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {change.proposedContent}
                    </pre>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleAction(change.id, "approve")}
                    disabled={processingId === change.id}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {processingId === change.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Approve
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleAction(change.id, "reject")}
                    disabled={processingId === change.id}
                    size="sm"
                    variant="outline"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
