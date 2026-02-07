"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import { Mail, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface GmailCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

/**
 * Renders the body content of a Gmail Action Card.
 * Shows To, CC, Subject, body (markdown or editable textarea),
 * and Draft/Send badge.
 */
export function GmailCardContent({ card, onDataChange, onAction }: GmailCardContentProps) {
  const data = card.data;
  const to = data.to as string | undefined;
  const cc = data.cc as string | undefined;
  const subject = data.subject as string | undefined;
  const body = (data.body as string) || "";
  const forceDraft = data.forceDraft as boolean | undefined;
  const isPending = card.status === "pending";

  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editBody when card data changes externally
  useEffect(() => {
    if (!isEditing) setEditBody(body);
  }, [body, isEditing]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      // Move cursor to end
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const handleSend = useCallback(() => {
    if (!onAction) return;
    // Save any pending edits before sending
    const currentData = isEditing ? { ...data, body: editBody } : data;
    if (isEditing && onDataChange) {
      onDataChange(currentData);
    }
    setIsEditing(false);
    onAction("send", currentData);
  }, [onAction, onDataChange, data, editBody, isEditing]);

  const handleCancel = useCallback(() => {
    if (isEditing) {
      setIsEditing(false);
      setEditBody(body);
      return;
    }
    onAction?.("cancel");
  }, [isEditing, body, onAction]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleEditSave = useCallback(() => {
    setIsEditing(false);
    onDataChange?.({ ...data, body: editBody });
  }, [onDataChange, data, editBody]);

  // Keyboard shortcuts (global when card is pending)
  useEffect(() => {
    if (!isPending) return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an unrelated input
      const target = e.target as HTMLElement;
      const isInOurTextarea = target === textareaRef.current;
      const isInOtherInput = !isInOurTextarea && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isInOtherInput) return;

      if (isEditing) {
        // In edit mode: Cmd+Enter saves and sends, Escape cancels edit
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          handleEditSave();
          handleSend();
        } else if (e.key === "Escape") {
          e.preventDefault();
          handleCancel();
        }
        return;
      }

      // Normal mode shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        handleEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPending, isEditing, handleSend, handleCancel, handleEdit, handleEditSave]);

  return (
    <div className="space-y-2 text-sm">
      {/* Header: To line + Draft/Send badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          {/* To line */}
          {to ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-3.5 flex-shrink-0" />
              <span className="truncate">
                To:{" "}
                <span className="text-foreground font-medium">{to}</span>
              </span>
            </div>
          ) : null}

          {/* CC line */}
          {cc ? (
            <div className="flex items-center gap-2 text-muted-foreground pl-[22px]">
              <span className="truncate">
                Cc:{" "}
                <span className="text-foreground/80">{cc}</span>
              </span>
            </div>
          ) : null}
        </div>

        {/* Draft / Send badge */}
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0",
            forceDraft
              ? "bg-amber-500/15 text-amber-400"
              : "bg-emerald-500/15 text-emerald-400"
          )}
        >
          {forceDraft ? (
            <>
              <FileEdit className="size-2.5" />
              Draft
            </>
          ) : (
            <>
              <Mail className="size-2.5" />
              Send
            </>
          )}
        </div>
      </div>

      {/* Subject line */}
      {subject ? (
        <div className="font-semibold text-foreground">{subject}</div>
      ) : null}

      {/* Body — editable or static with markdown */}
      {isEditing ? (
        <div className="space-y-1">
          <textarea
            ref={textareaRef}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="w-full rounded-md bg-muted/50 border border-gold/30 p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-gold/50"
            rows={Math.max(3, editBody.split("\n").length + 1)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleEditSave}
              className="text-xs text-gold hover:text-gold-bright transition-colors"
            >
              Save
            </button>
            <span className="text-xs text-muted-foreground">·</span>
            <button
              onClick={handleCancel}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <span className="text-xs text-muted-foreground ml-auto">⌘↵ save & send</span>
          </div>
        </div>
      ) : body ? (
        <div
          onClick={isPending ? handleEdit : undefined}
          className={cn(
            "rounded-md bg-muted/50 p-3 text-foreground chat-prose",
            isPending && "cursor-text hover:border hover:border-gold/20"
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              ),
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      ) : null}

      {/* Keyboard shortcut hints — only when pending and not editing */}
      {isPending && !isEditing ? (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">⌘↵</kbd> send</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">e</kbd> edit</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">esc</kbd> cancel</span>
        </div>
      ) : null}
    </div>
  );
}
