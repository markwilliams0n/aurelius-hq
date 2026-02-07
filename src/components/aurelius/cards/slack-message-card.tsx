"use client";

import type { ActionCardData } from "@/lib/types/action-card";
import { Hash, User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlackMessageCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
}

/**
 * Renders the body content of a Slack message Action Card.
 * Shows recipient, delivery method, send-as toggle, and message preview.
 */
export function SlackMessageCardContent({ card, onDataChange }: SlackMessageCardContentProps) {
  const data = card.data;
  const recipientType = data.recipientType as string | undefined;
  const recipientName = (data.recipientName || data.recipient) as string | undefined;
  const channelName = data.channelName as string | undefined;
  const message = data.message as string | undefined;
  const sendAs = (data.sendAs as string) || "bot";
  const canSendAsUser = data.canSendAsUser as boolean | undefined;
  const isPending = card.status === "pending";

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

      {/* Message body */}
      {message ? (
        <div className="rounded-md bg-muted/50 p-3 whitespace-pre-wrap text-foreground">
          {message}
        </div>
      ) : null}
    </div>
  );
}
