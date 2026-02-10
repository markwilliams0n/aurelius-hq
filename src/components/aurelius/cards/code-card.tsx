"use client";

import type { ActionCardData } from "@/lib/types/action-card";
import type { CodeResult } from "@/lib/code/types";

interface CodeCardContentProps {
  card: ActionCardData;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

function StatusDot({ className, pulse }: { className: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${className} ${pulse ? "animate-pulse" : ""}`}
    />
  );
}

function BranchLabel({ branchName }: { branchName: string }) {
  return (
    <p className="text-muted-foreground">
      Branch:{" "}
      <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded font-mono text-foreground">
        {branchName}
      </code>
    </p>
  );
}

/**
 * Renders code session action cards with 4 states:
 * pending, running, completed, error.
 */
export function CodeCardContent({ card, onAction }: CodeCardContentProps) {
  const data = card.data as {
    sessionId?: string;
    task: string;
    context: string | null;
    branchName: string;
    worktreePath?: string;
    result?: CodeResult;
  };

  const { task, context, branchName } = data;

  if (card.status === "error") {
    const errorMessage =
      (card.result?.error as string) || "Unknown error occurred";
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <StatusDot className="bg-red-500" />
          <span className="font-medium text-red-400">Session failed</span>
        </div>
        <p className="text-muted-foreground">{errorMessage}</p>
      </div>
    );
  }

  if (data.result) {
    const { result } = data;
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <StatusDot className="bg-green-500" />
          <span className="font-medium text-green-400">Session complete</span>
          <span className="text-muted-foreground">
            {result.turns} turn{result.turns !== 1 ? "s" : ""}
            {result.costUsd !== null && ` · $${result.costUsd.toFixed(2)}`}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {result.stats.filesChanged} file
            {result.stats.filesChanged !== 1 ? "s" : ""} changed
          </span>
          <span className="text-green-400">+{result.stats.insertions}</span>
          <span className="text-red-400">-{result.stats.deletions}</span>
        </div>

        {result.changedFiles.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">
              Changed files:
            </p>
            <ul className="text-xs text-foreground space-y-0.5">
              {result.changedFiles.map((file) => (
                <li key={file} className="font-mono truncate">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.log && (
          <pre className="text-xs bg-muted/50 rounded-md p-3 whitespace-pre-wrap overflow-x-auto text-foreground max-h-48 overflow-y-auto">
            {result.log}
          </pre>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() =>
              onAction?.("approve", {
                worktreePath: data.worktreePath,
                branchName,
                _confirmed: true,
              })
            }
            className="px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
          >
            Approve &amp; Merge
          </button>
          <button
            onClick={() =>
              onAction?.("reject", {
                worktreePath: data.worktreePath,
                branchName,
              })
            }
            className="px-3 py-1.5 rounded-md border border-muted-foreground/30 text-muted-foreground text-xs font-medium hover:bg-muted/50 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  if (card.status === "confirmed") {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <StatusDot className="bg-amber-400" pulse />
          <span className="font-medium text-amber-400">
            Session running...
          </span>
        </div>

        <p className="text-foreground">{task}</p>
        <BranchLabel branchName={branchName} />

        <div className="pt-1">
          <button
            onClick={() =>
              onAction?.("stop", {
                sessionId: data.sessionId,
                worktreePath: data.worktreePath,
                branchName,
              })
            }
            className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
          >
            Stop Session
          </button>
        </div>
      </div>
    );
  }

  // Pending state (default)
  return (
    <div className="space-y-2 text-sm">
      <p className="text-foreground">{task}</p>
      {context && <p className="text-muted-foreground">{context}</p>}
      <BranchLabel branchName={branchName} />
    </div>
  );
}
