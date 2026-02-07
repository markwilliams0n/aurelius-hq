"use client";

import type { ActionCardData } from "@/lib/types/action-card";
import { Hash, User } from "lucide-react";

interface SlackMessageCardContentProps {
  card: ActionCardData;
}

/**
 * Renders the body content of a Slack message Action Card.
 * Shows recipient, delivery method, and message preview.
 */
export function SlackMessageCardContent({ card }: SlackMessageCardContentProps) {
  const data = card.data;
  const recipientType = data.recipientType as string | undefined;
  const recipientName = (data.recipientName || data.recipient) as string | undefined;
  const channelName = data.channelName as string | undefined;
  const message = data.message as string | undefined;
  const includeMe = data.includeMe as boolean | undefined;

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
          {recipientType === "dm" && includeMe ? (
            <span className="text-xs opacity-70">(+ you, via group DM)</span>
          ) : null}
        </div>
      ) : null}

      {/* Channel context for channel messages */}
      {recipientType === "channel" && channelName ? (
        <div className="text-xs text-muted-foreground">
          Posting to #{channelName} with @mention cc
        </div>
      ) : null}

      {/* Message body */}
      {message ? (
        <div className="rounded-md bg-muted/50 p-3 whitespace-pre-wrap text-foreground">
          {message}
        </div>
      ) : null}
    </div>
  );
}
