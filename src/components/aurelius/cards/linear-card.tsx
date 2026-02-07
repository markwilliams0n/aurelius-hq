"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import { AlertTriangle, User, Users, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface LinearCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

const PRIORITY_CONFIG: Record<number, { label: string; color: string; bgColor: string }> = {
  0: { label: "None", color: "text-muted-foreground", bgColor: "bg-muted/50" },
  1: { label: "Urgent", color: "text-red-400", bgColor: "bg-red-500/15" },
  2: { label: "High", color: "text-orange-400", bgColor: "bg-orange-500/15" },
  3: { label: "Medium", color: "text-yellow-400", bgColor: "bg-yellow-500/15" },
  4: { label: "Low", color: "text-blue-400", bgColor: "bg-blue-500/15" },
};

/**
 * Renders the body content of a Linear issue Action Card.
 * Shows editable title, collapsible description, priority badge,
 * team badge, assignee display, and keyboard shortcut hints.
 */
export function LinearCardContent({ card, onDataChange, onAction }: LinearCardContentProps) {
  const data = card.data;
  const title = (data.title as string) || "";
  const description = (data.description as string) || "";
  const teamName = data.teamName as string | undefined;
  const assigneeName = data.assigneeName as string | undefined;
  const priority = (data.priority as number) ?? 0;
  const isPending = card.status === "pending";

  const [editTitle, setEditTitle] = useState(title);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [isDescEditing, setIsDescEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(description);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus title on mount when pending
  useEffect(() => {
    if (isPending && titleRef.current) {
      titleRef.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external data changes
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setEditTitle(title);
  }, [title]);

  useEffect(() => {
    if (!isDescEditing) setEditDesc(description);
  }, [description, isDescEditing]);

  // Auto-focus description textarea when entering edit mode
  useEffect(() => {
    if (isDescEditing && descRef.current) {
      descRef.current.focus();
      const len = descRef.current.value.length;
      descRef.current.setSelectionRange(len, len);
    }
  }, [isDescEditing]);

  const emitDataChange = useCallback((updates: Partial<Record<string, unknown>>) => {
    onDataChange?.({ ...data, ...updates });
  }, [onDataChange, data]);

  const handleTitleChange = useCallback((value: string) => {
    setEditTitle(value);
    emitDataChange({ title: value });
  }, [emitDataChange]);

  const cyclePriority = useCallback(() => {
    if (!isPending) return;
    const next = priority >= 4 ? 0 : priority + 1;
    emitDataChange({ priority: next });
  }, [isPending, priority, emitDataChange]);

  const handleDescSave = useCallback(() => {
    setIsDescEditing(false);
    emitDataChange({ description: editDesc });
  }, [emitDataChange, editDesc]);

  const handleDescCancel = useCallback(() => {
    setIsDescEditing(false);
    setEditDesc(description);
  }, [description]);

  const handleCreate = useCallback(() => {
    if (!onAction) return;
    const currentData: Record<string, unknown> = { ...data, title: editTitle };
    if (isDescEditing) {
      currentData.description = editDesc;
    }
    onAction("send", currentData);
  }, [onAction, data, editTitle, isDescEditing, editDesc]);

  const handleCancel = useCallback(() => {
    if (isDescEditing) {
      handleDescCancel();
      return;
    }
    onAction?.("cancel");
  }, [isDescEditing, handleDescCancel, onAction]);

  // Keyboard shortcuts (global when card is pending)
  useEffect(() => {
    if (!isPending) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInOurTitle = target === titleRef.current;
      const isInOurDesc = target === descRef.current;
      const isInOurInput = isInOurTitle || isInOurDesc;
      const isInOtherInput = !isInOurInput && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isInOtherInput) return;

      // Cmd+Enter always creates
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (isDescEditing) handleDescSave();
        handleCreate();
        return;
      }

      // Escape handling
      if (e.key === "Escape") {
        e.preventDefault();
        if (isDescEditing) {
          handleDescCancel();
        } else if (isInOurTitle) {
          titleRef.current?.blur();
        } else {
          handleCancel();
        }
        return;
      }

      // Don't process single-key shortcuts if in an input
      if (isInOurInput) return;

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        titleRef.current?.focus();
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        cyclePriority();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPending, isDescEditing, handleCreate, handleCancel, handleDescSave, handleDescCancel, cyclePriority]);

  const priorityConfig = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG[0];

  // Determine if description should be truncated
  const descLines = description.split("\n");
  const isTruncatable = descLines.length > 3 || description.length > 200;
  const truncatedDesc = isTruncatable && !isDescExpanded
    ? descLines.slice(0, 3).join("\n").slice(0, 200) + (description.length > 200 || descLines.length > 3 ? "..." : "")
    : description;

  return (
    <div className="space-y-2.5 text-sm">
      {/* Title — inline editable input */}
      {isPending ? (
        <input
          ref={titleRef}
          type="text"
          value={editTitle}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Issue title..."
          className="w-full bg-transparent text-foreground font-semibold text-base border-b border-transparent focus:border-gold/40 focus:outline-none placeholder:text-muted-foreground/50 py-0.5"
        />
      ) : (
        <div className="font-semibold text-foreground text-base">{title}</div>
      )}

      {/* Metadata row: team, priority, assignee */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Team badge */}
        {teamName ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-[11px] text-muted-foreground">
            <Users className="size-2.5" />
            {teamName}
          </span>
        ) : null}

        {/* Priority badge — clickable when pending */}
        <button
          onClick={isPending ? cyclePriority : undefined}
          disabled={!isPending}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors",
            priorityConfig.bgColor,
            priorityConfig.color,
            isPending && "cursor-pointer hover:opacity-80"
          )}
        >
          <AlertTriangle className="size-2.5" />
          {priorityConfig.label}
        </button>

        {/* Assignee badge */}
        {assigneeName ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-[11px] text-muted-foreground">
            <User className="size-2.5" />
            {assigneeName}
          </span>
        ) : null}
      </div>

      {/* Description — collapsible, editable */}
      {(description || isPending) ? (
        <div className="space-y-1">
          {isDescEditing ? (
            <div className="space-y-1">
              <textarea
                ref={descRef}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description (optional, markdown supported)..."
                className="w-full rounded-md bg-muted/50 border border-gold/30 p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-gold/50"
                rows={Math.max(3, editDesc.split("\n").length + 1)}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDescSave}
                  className="text-xs text-gold hover:text-gold-bright transition-colors"
                >
                  Save
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  onClick={handleDescCancel}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : description ? (
            <div className="rounded-md bg-muted/50 p-3">
              <div className="chat-prose text-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                    ),
                  }}
                >
                  {truncatedDesc}
                </ReactMarkdown>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {isTruncatable ? (
                  <button
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-0.5"
                  >
                    {isDescExpanded ? (
                      <>
                        <ChevronUp className="size-3" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-3" />
                        Show more
                      </>
                    )}
                  </button>
                ) : null}
                {isPending ? (
                  <button
                    onClick={() => setIsDescEditing(true)}
                    className="text-xs text-gold/70 hover:text-gold transition-colors"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          ) : isPending ? (
            <button
              onClick={() => setIsDescEditing(true)}
              className="w-full text-left rounded-md bg-muted/30 p-3 text-sm text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              Add description...
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Keyboard shortcut hints — only when pending and not editing description */}
      {isPending && !isDescEditing ? (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">⌘↵</kbd> create</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">e</kbd> title</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">p</kbd> priority</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">esc</kbd> cancel</span>
        </div>
      ) : null}
    </div>
  );
}
