"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import { Hash, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlackMessageCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

/**
 * Renders the body content of a Slack message Action Card.
 * Shows recipient, send-as toggle, message (editable), and keyboard shortcut hints.
 */
export function SlackMessageCardContent({ card, onDataChange, onAction }: SlackMessageCardContentProps) {
  const data = card.data;
  const recipientType = data.recipientType as string | undefined;
  const recipientName = (data.recipientName || data.recipient) as string | undefined;
  const message = (data.message as string) || "";
  const sendAs = (data.sendAs as string) || "bot";
  const canSendAsUser = data.canSendAsUser as boolean | undefined;
  const isPending = card.status === "pending";

  const [isEditing, setIsEditing] = useState(false);
  const [editMessage, setEditMessage] = useState(message);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editMessage when card data changes externally
  useEffect(() => {
    if (!isEditing) setEditMessage(message);
  }, [message, isEditing]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      // Move cursor to end
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const toggleSendAs = useCallback(() => {
    if (!canSendAsUser || !onDataChange) return;
    onDataChange({ ...data, sendAs: sendAs === "user" ? "bot" : "user" });
  }, [canSendAsUser, onDataChange, data, sendAs]);

  const handleSend = useCallback(() => {
    if (!onAction) return;
    // Save any pending edits before sending
    const currentData = isEditing ? { ...data, message: editMessage } : data;
    if (isEditing && onDataChange) {
      onDataChange(currentData);
    }
    setIsEditing(false);
    onAction("send", currentData);
  }, [onAction, onDataChange, data, editMessage, isEditing]);

  const handleCancel = useCallback(() => {
    if (isEditing) {
      setIsEditing(false);
      setEditMessage(message);
      return;
    }
    onAction?.("cancel");
  }, [isEditing, message, onAction]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleEditSave = useCallback(() => {
    setIsEditing(false);
    onDataChange?.({ ...data, message: editMessage });
  }, [onDataChange, data, editMessage]);

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
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        toggleSendAs();
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
  }, [isPending, isEditing, handleSend, handleCancel, handleEdit, handleEditSave, toggleSendAs]);

  return (
    <div className="space-y-2 text-sm">
      {/* Recipient line */}
      {recipientName ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          {recipientType === "channel" ? (
            <Hash className="size-3.5" />
          ) : (
            <User className="size-3.5" />
          )}
          <span>
            To:{" "}
            <span className="text-foreground font-medium">{recipientName}</span>
          </span>
        </div>
      ) : null}

      {/* Send-as toggle */}
      {isPending && canSendAsUser && onDataChange ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">From:</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => onDataChange({ ...data, sendAs: "user" })}
              className={cn(
                "px-2.5 py-1 flex items-center gap-1.5 transition-colors",
                sendAs === "user"
                  ? "bg-gold/15 text-gold border-r border-border"
                  : "text-muted-foreground hover:text-foreground border-r border-border"
              )}
            >
              <User className="size-3" />
              Me
            </button>
            <button
              onClick={() => onDataChange({ ...data, sendAs: "bot" })}
              className={cn(
                "px-2.5 py-1 flex items-center gap-1.5 transition-colors",
                sendAs === "bot"
                  ? "bg-gold/15 text-gold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Bot className="size-3" />
              Aurelius
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {sendAs === "user" ? (
            <>
              <User className="size-3" />
              Sent as you
            </>
          ) : (
            <>
              <Bot className="size-3" />
              Sent as Aurelius
              {recipientType === "dm" ? " (group DM)" : " (with @mention cc)"}
            </>
          )}
        </div>
      )}

      {/* Message body — editable or static */}
      {isEditing ? (
        <div className="space-y-1">
          <textarea
            ref={textareaRef}
            value={editMessage}
            onChange={(e) => setEditMessage(e.target.value)}
            className="w-full rounded-md bg-muted/50 border border-gold/30 p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-gold/50"
            rows={Math.max(3, editMessage.split("\n").length + 1)}
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
      ) : message ? (
        <div
          onClick={isPending ? handleEdit : undefined}
          className={cn(
            "rounded-md bg-muted/50 p-3 whitespace-pre-wrap text-foreground",
            isPending && "cursor-text hover:border hover:border-gold/20"
          )}
        >
          {message}
        </div>
      ) : null}

      {/* Keyboard shortcut hints — only when pending and not editing */}
      {isPending && !isEditing ? (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">⌘↵</kbd> send</span>
          {canSendAsUser ? (
            <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">tab</kbd> switch sender</span>
          ) : null}
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">e</kbd> edit</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px]">esc</kbd> cancel</span>
        </div>
      ) : null}
    </div>
  );
}
