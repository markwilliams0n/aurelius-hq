"use client";

import { useState } from "react";
import {
  X,
  FileText,
  Settings,
  Check,
  Copy,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Panel content types
export type ConfigViewContent = {
  type: "config_view";
  key: string;
  description: string;
  content: string | null;
  version?: number;
  createdBy?: string;
  createdAt?: string;
};

export type ConfigDiffContent = {
  type: "config_diff";
  key: string;
  reason: string;
  currentContent: string | null;
  proposedContent: string;
  pendingChangeId: string;
};

export type ToolResultContent = {
  type: "tool_result";
  toolName: string;
  result: string;
};

export type PanelContent = ConfigViewContent | ConfigDiffContent | ToolResultContent | null;

interface ToolPanelProps {
  content: PanelContent;
  onClose: () => void;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}

export function ToolPanel({ content, onClose, onApprove, onReject }: ToolPanelProps) {
  if (!content) return null;

  return (
    <aside className="h-full border-l border-border bg-background flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {content.type === "config_view" && <FileText className="w-4 h-4 text-gold" />}
          {content.type === "config_diff" && <Settings className="w-4 h-4 text-yellow-500" />}
          {content.type === "tool_result" && <Settings className="w-4 h-4 text-muted-foreground" />}
          <h3 className="font-medium text-sm">
            {content.type === "config_view" && `Config: ${content.key}`}
            {content.type === "config_diff" && `Proposed Change: ${content.key}`}
            {content.type === "tool_result" && `Tool: ${content.toolName}`}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {content.type === "config_view" && (
          <ConfigViewPanel content={content} />
        )}
        {content.type === "config_diff" && (
          <ConfigDiffPanel
            content={content}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
        {content.type === "tool_result" && (
          <ToolResultPanel content={content} />
        )}
      </div>
    </aside>
  );
}

function ConfigViewPanel({ content }: { content: ConfigViewContent }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (content.content) {
      await navigator.clipboard.writeText(content.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Copied to clipboard");
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Metadata */}
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">{content.description}</p>
        {content.version && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Version {content.version}</span>
            {content.createdBy && <span>by {content.createdBy}</span>}
          </div>
        )}
      </div>

      {/* Content */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">Content</span>
          {content.content && (
            <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2">
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          )}
        </div>
        <pre className="text-sm p-3 rounded-lg bg-secondary/50 border border-border overflow-x-auto whitespace-pre-wrap font-mono">
          {content.content || "(not set)"}
        </pre>
      </div>
    </div>
  );
}

// Simple diff line type
type DiffLine = {
  type: "context" | "added" | "removed";
  content: string;
};

// Compute LCS (Longest Common Subsequence) for proper diff
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

// Compute a proper line-based diff using LCS
function computeDiff(oldText: string | null, newText: string): DiffLine[] {
  const oldLines = (oldText || "").split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Use LCS to find common lines
  const dp = computeLCS(oldLines, newLines);

  // Backtrack to build diff
  let i = oldLines.length;
  let j = newLines.length;
  const reversed: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Common line
      reversed.push({ type: "context", content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Line added in new
      reversed.push({ type: "added", content: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      // Line removed from old
      reversed.push({ type: "removed", content: oldLines[i - 1] });
      i--;
    }
  }

  // Reverse to get correct order
  for (let k = reversed.length - 1; k >= 0; k--) {
    result.push(reversed[k]);
  }

  return result;
}

// Collapse unchanged context lines, keeping only N lines around changes
function collapseDiff(diff: DiffLine[], contextLines: number = 2): (DiffLine | { type: "collapse"; count: number })[] {
  const result: (DiffLine | { type: "collapse"; count: number })[] = [];

  // Find indices of changed lines
  const changedIndices = new Set<number>();
  diff.forEach((line, i) => {
    if (line.type !== "context") {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(diff.length - 1, i + contextLines); j++) {
        changedIndices.add(j);
      }
    }
  });

  let collapsedCount = 0;
  diff.forEach((line, i) => {
    if (changedIndices.has(i)) {
      if (collapsedCount > 0) {
        result.push({ type: "collapse", count: collapsedCount });
        collapsedCount = 0;
      }
      result.push(line);
    } else {
      collapsedCount++;
    }
  });

  if (collapsedCount > 0) {
    result.push({ type: "collapse", count: collapsedCount });
  }

  return result;
}

function ConfigDiffPanel({
  content,
  onApprove,
  onReject,
}: {
  content: ConfigDiffContent;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}) {
  const [processing, setProcessing] = useState<"approve" | "reject" | null>(null);

  const handleApprove = async () => {
    if (!onApprove) return;
    setProcessing("approve");
    try {
      await onApprove(content.pendingChangeId);
      toast.success("Change approved and applied");
    } catch {
      toast.error("Failed to approve change");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!onReject) return;
    setProcessing("reject");
    try {
      await onReject(content.pendingChangeId);
      toast.success("Change rejected");
    } catch {
      toast.error("Failed to reject change");
    } finally {
      setProcessing(null);
    }
  };

  // Compute diff
  const diff = computeDiff(content.currentContent, content.proposedContent);
  const collapsedDiff = collapseDiff(diff);

  // Count changes
  const additions = diff.filter(d => d.type === "added").length;
  const removals = diff.filter(d => d.type === "removed").length;

  return (
    <div className="p-4 space-y-4">
      {/* Reason */}
      <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-yellow-500">Proposed Change</div>
            <p className="text-sm text-muted-foreground mt-1">{content.reason}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-xs">
        {additions > 0 && (
          <span className="text-green-500">+{additions} added</span>
        )}
        {removals > 0 && (
          <span className="text-red-500">-{removals} removed</span>
        )}
      </div>

      {/* Diff View */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground border-b border-border font-mono">
          {content.key}
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <pre className="text-sm font-mono">
            {collapsedDiff.map((line, i) => {
              if ("count" in line) {
                return (
                  <div
                    key={i}
                    className="px-3 py-1 text-muted-foreground bg-secondary/20 text-center text-xs"
                  >
                    ... {line.count} unchanged lines ...
                  </div>
                );
              }

              const bgClass =
                line.type === "added"
                  ? "bg-green-500/10"
                  : line.type === "removed"
                  ? "bg-red-500/10"
                  : "";
              const textClass =
                line.type === "added"
                  ? "text-green-400"
                  : line.type === "removed"
                  ? "text-red-400"
                  : "text-muted-foreground";
              const prefix =
                line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

              return (
                <div key={i} className={`px-3 py-0.5 ${bgClass}`}>
                  <span className={`${textClass} select-none mr-2`}>{prefix}</span>
                  <span className={line.type === "context" ? "text-foreground/70" : textClass}>
                    {line.content}
                  </span>
                </div>
              );
            })}
          </pre>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button
          onClick={handleApprove}
          disabled={!!processing}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          {processing === "approve" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4 mr-1" />
              Approve
            </>
          )}
        </Button>
        <Button
          onClick={handleReject}
          disabled={!!processing}
          variant="outline"
          className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
        >
          <X className="w-4 h-4 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}

function ToolResultPanel({ content }: { content: ToolResultContent }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  // Try to parse as JSON for pretty display
  let displayContent = content.result;
  let isJson = false;
  try {
    const parsed = JSON.parse(content.result);
    displayContent = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch {
    // Not JSON, display as-is
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">
          {isJson ? "JSON Result" : "Result"}
        </span>
        <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2">
          {copied ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </Button>
      </div>
      <pre className="text-sm p-3 rounded-lg bg-secondary/50 border border-border overflow-x-auto whitespace-pre-wrap font-mono">
        {displayContent}
      </pre>
    </div>
  );
}
