"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActionCardData } from "@/lib/types/action-card";
import { cn } from "@/lib/utils";

interface ConfigCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
}

/**
 * Config pattern: "Here's state you can view or change."
 * Renders config content as markdown with click-to-edit in pending state.
 */
export function ConfigCardContent({ card, onDataChange }: ConfigCardContentProps) {
  const isPending = card.status === "pending";
  const entries = card.data.entries as Array<{ key: string; value: string; editable?: boolean }> | undefined;
  const content = card.data.content as string | undefined;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState("");

  // Structured entries mode (key-value configs)
  if (entries) {
    return (
      <div className="space-y-1 text-sm">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0 min-w-[100px]">{entry.key}:</span>
            {isPending && entry.editable && editingKey === entry.key ? (
              <div className="flex-1 flex items-center gap-1">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 bg-muted/50 border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const updated = entries.map((ent) =>
                        ent.key === entry.key ? { ...ent, value: editValue } : ent
                      );
                      onDataChange?.({ ...card.data, entries: updated });
                      setEditingKey(null);
                    }
                    if (e.key === "Escape") setEditingKey(null);
                  }}
                />
              </div>
            ) : (
              <span
                className={cn(
                  "text-foreground",
                  isPending && entry.editable && "cursor-text hover:text-gold transition-colors"
                )}
                onClick={() => {
                  if (isPending && entry.editable) {
                    setEditingKey(entry.key);
                    setEditValue(entry.value);
                  }
                }}
              >
                {entry.value || <span className="text-muted-foreground italic">empty</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Content mode (markdown configs like capability prompts)
  if (content !== undefined) {
    if (isEditingContent) {
      return (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[200px] bg-muted/50 border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 resize-y"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                onDataChange?.({ ...card.data, content: editContent });
                setIsEditingContent(false);
              }}
              className="text-xs px-2 py-1 rounded bg-gold/20 text-gold hover:bg-gold/30 transition-colors"
            >
              Done editing
            </button>
            <button
              onClick={() => setIsEditingContent(false)}
              className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "chat-prose text-sm",
          isPending && "cursor-pointer hover:ring-1 hover:ring-gold/30 rounded-md p-1 -m-1 transition-all"
        )}
        onClick={() => {
          if (isPending) {
            setEditContent(content || "");
            setIsEditingContent(true);
          }
        }}
        title={isPending ? "Click to edit" : undefined}
      >
        {content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        ) : (
          <span className="text-muted-foreground italic">No content set. Click to add.</span>
        )}
      </div>
    );
  }

  // Fallback: raw data display (filter out metadata keys)
  const metaKeys = new Set(["key", "description", "version"]);
  const displayEntries = Object.entries(card.data).filter(([k]) => !metaKeys.has(k));

  if (displayEntries.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No configuration data.</p>;
  }

  return (
    <div className="space-y-1 text-sm">
      {displayEntries.map(([key, value]) => (
        <p key={key}>
          <span className="text-muted-foreground">{key}: </span>
          <span className="text-foreground">{String(value)}</span>
        </p>
      ))}
    </div>
  );
}
